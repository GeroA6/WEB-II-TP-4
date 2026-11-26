import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { ClientMessage, Participant, ServerMessage } from "../../shared/protocol.js";
import type { ProposalService } from "./proposalService.js";
import type { GiftListStore } from "./store.js";
import { parseClientMessage } from "./validation.js";

export type StateChangeListener = () => void;

export interface WsGatewayDependencies {
  httpServer: Server;
  store: GiftListStore;
  proposalService: ProposalService;
  path?: string;
  heartbeatIntervalMs?: number;
  onStateChange?: StateChangeListener;
}

/**
 * Capa de transporte WebSocket para participantes (SRP + OCP).
 * Comparte el mismo servidor HTTP y puerto, delega validaciones y reglas de negocio,
 * detecta conexiones muertas mediante ping/pong y notifica cambios de estado mediante onStateChange.
 */
export class WsGateway {
  private readonly wss: WebSocketServer;
  private readonly store: GiftListStore;
  private readonly proposalService: ProposalService;
  private readonly joinedSockets = new Map<string, WebSocket>();
  private readonly aliveState = new WeakMap<WebSocket, boolean>();
  private readonly onStateChange?: StateChangeListener;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(deps: WsGatewayDependencies) {
    this.store = deps.store;
    this.proposalService = deps.proposalService;
    this.onStateChange = deps.onStateChange;

    this.wss = new WebSocketServer({
      server: deps.httpServer,
      path: deps.path ?? "/ws",
    });

    this.wss.on("connection", (ws) => this.handleConnection(ws));

    const heartbeatMs = deps.heartbeatIntervalMs ?? 15000;
    if (heartbeatMs > 0) {
      this.heartbeatTimer = setInterval(() => this.runHeartbeat(), heartbeatMs);
    }
  }

  private runHeartbeat(): void {
    for (const ws of this.wss.clients) {
      if (this.aliveState.get(ws) === false) {
        // No respondió pong al ping anterior: conexión muerta -> terminar
        ws.terminate();
        continue;
      }
      this.aliveState.set(ws, false);
      ws.ping();
    }
  }

  private handleConnection(ws: WebSocket): void {
    let sessionId: string | null = null;
    this.aliveState.set(ws, true);

    ws.on("pong", () => {
      this.aliveState.set(ws, true);
    });

    ws.on("message", (raw: RawData) => {
      const text = this.rawDataToString(raw);
      const parsed = parseClientMessage(text);

      if (!parsed.ok) {
        this.send(ws, {
          type: "error",
          code: parsed.code,
          message: parsed.message,
        });
        return;
      }

      sessionId = this.handleMessage(ws, sessionId, parsed.value);
    });

    ws.on("close", () => {
      if (sessionId !== null) {
        this.cleanupConnection(sessionId);
        sessionId = null;
      }
    });

    ws.on("error", () => {
      if (sessionId !== null) {
        this.cleanupConnection(sessionId);
        sessionId = null;
      }
    });
  }

  private handleMessage(
    ws: WebSocket,
    currentSessionId: string | null,
    msg: ClientMessage
  ): string | null {
    switch (msg.type) {
      case "join": {
        if (currentSessionId !== null) {
          this.send(ws, {
            type: "error",
            code: "ALREADY_JOINED",
            message: "Esta conexión ya ingresó con un nombre.",
          });
          return currentSessionId;
        }

        // Reutiliza participantId previo si la sesión anterior ya se desconectó
        const candidateId =
          msg.participantId &&
          !this.joinedSockets.has(msg.participantId) &&
          !this.store.getParticipant(msg.participantId)
            ? msg.participantId
            : randomUUID();

        const result = this.store.joinParticipant(candidateId, msg.name);
        if (!result.ok) {
          this.send(ws, {
            type: "error",
            code: result.code,
            message: result.message,
          });
          return null;
        }

        this.joinedSockets.set(candidateId, ws);

        // Quien entra recibe el estado completo de inmediato
        this.send(ws, {
          type: "welcome",
          self: result.value,
          participants: this.store.getParticipants(),
          products: this.store.getSortedProducts(),
        });

        // Los demás participantes conectados reciben la lista actualizada
        this.broadcast(
          {
            type: "participants_updated",
            participants: this.store.getParticipants(),
          },
          candidateId
        );
        this.onStateChange?.();
        return candidateId;
      }

      case "propose_products": {
        const participant =
          currentSessionId !== null ? this.store.getParticipant(currentSessionId) : undefined;
        if (!participant) {
          this.send(ws, {
            type: "error",
            code: "NOT_JOINED",
            message: "Debes ingresar con un nombre antes de proponer productos.",
          });
          return currentSessionId;
        }

        // Operación asíncrona sin bloquear el Event Loop ni a los demás usuarios
        void this.handleProposal(ws, participant, msg.productIds);
        return currentSessionId;
      }

      case "vote": {
        if (currentSessionId === null) {
          this.send(ws, {
            type: "error",
            code: "NOT_JOINED",
            message: "Debes ingresar con un nombre antes de votar.",
          });
          return null;
        }
        const result = this.store.voteProduct(currentSessionId, msg.productId);
        if (!result.ok) {
          this.send(ws, {
            type: "error",
            code: result.code,
            message: result.message,
          });
          return currentSessionId;
        }

        this.broadcastProducts();
        return currentSessionId;
      }

      case "unvote": {
        if (currentSessionId === null) {
          this.send(ws, {
            type: "error",
            code: "NOT_JOINED",
            message: "Debes ingresar con un nombre antes de retirar un voto.",
          });
          return null;
        }
        const result = this.store.unvoteProduct(currentSessionId, msg.productId);
        if (!result.ok) {
          this.send(ws, {
            type: "error",
            code: result.code,
            message: result.message,
          });
          return currentSessionId;
        }

        this.broadcastProducts();
        return currentSessionId;
      }

      case "remove_product": {
        if (currentSessionId === null) {
          this.send(ws, {
            type: "error",
            code: "NOT_JOINED",
            message: "Debes ingresar con un nombre antes de quitar productos.",
          });
          return null;
        }
        const result = this.store.removeProduct(currentSessionId, msg.productId);
        if (!result.ok) {
          this.send(ws, {
            type: "error",
            code: result.code,
            message: result.message,
          });
          return currentSessionId;
        }

        this.broadcastProducts();
        return currentSessionId;
      }
    }
  }

  private async handleProposal(
    ws: WebSocket,
    proposer: Participant,
    productIds: number[]
  ): Promise<void> {
    try {
      const outcome = await this.proposalService.proposeProducts(proposer, productIds);

      if (outcome.addedIds.length > 0) {
        this.broadcastProducts();
      }

      // Los errores/resultados parciales se envían SOLO a quien propuso
      this.send(ws, {
        type: "proposal_result",
        addedIds: outcome.addedIds,
        failures: outcome.failures,
      });
    } catch {
      this.send(ws, {
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Ocurrió un error inesperado al procesar la propuesta.",
      });
    }
  }

  private broadcastProducts(): void {
    this.broadcast({
      type: "products_updated",
      products: this.store.getSortedProducts(),
    });
    this.onStateChange?.();
  }

  private cleanupConnection(connectionId: string): void {
    this.joinedSockets.delete(connectionId);
    const removed = this.store.leaveParticipant(connectionId);

    if (removed) {
      this.broadcast({
        type: "participants_updated",
        participants: this.store.getParticipants(),
      });
      this.onStateChange?.();
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcast(message: ServerMessage, excludeConnectionId?: string): void {
    const payload = JSON.stringify(message);
    for (const [id, socket] of this.joinedSockets.entries()) {
      if (id === excludeConnectionId) {
        continue;
      }
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  private rawDataToString(raw: RawData): string {
    if (typeof raw === "string") {
      return raw;
    }
    if (Buffer.isBuffer(raw)) {
      return raw.toString("utf8");
    }
    if (Array.isArray(raw)) {
      return Buffer.concat(raw).toString("utf8");
    }
    return Buffer.from(raw).toString("utf8");
  }

  close(): Promise<void> {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.wss.clients) {
      client.terminate();
    }
    this.joinedSockets.clear();
    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }
}
