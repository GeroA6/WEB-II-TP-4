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
  onStateChange?: StateChangeListener;
}

/**
 * Capa de transporte WebSocket para participantes (SRP + OCP).
 * Comparte el mismo servidor HTTP y puerto, delega validaciones y reglas de negocio
 * y notifica cambios de estado mediante onStateChange (permitiendo acoplar SSE luego).
 */
export class WsGateway {
  private readonly wss: WebSocketServer;
  private readonly store: GiftListStore;
  private readonly proposalService: ProposalService;
  private readonly joinedSockets = new Map<string, WebSocket>();
  private readonly onStateChange?: StateChangeListener;

  constructor(deps: WsGatewayDependencies) {
    this.store = deps.store;
    this.proposalService = deps.proposalService;
    this.onStateChange = deps.onStateChange;

    this.wss = new WebSocketServer({
      server: deps.httpServer,
      path: deps.path ?? "/ws",
    });

    this.wss.on("connection", (ws) => this.handleConnection(ws));
  }

  private handleConnection(ws: WebSocket): void {
    const connectionId = randomUUID();

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

      this.handleMessage(ws, connectionId, parsed.value);
    });

    ws.on("close", () => {
      this.cleanupConnection(connectionId);
    });

    ws.on("error", () => {
      this.cleanupConnection(connectionId);
    });
  }

  private handleMessage(ws: WebSocket, connectionId: string, msg: ClientMessage): void {
    switch (msg.type) {
      case "join": {
        const result = this.store.joinParticipant(connectionId, msg.name);
        if (!result.ok) {
          this.send(ws, {
            type: "error",
            code: result.code,
            message: result.message,
          });
          return;
        }

        this.joinedSockets.set(connectionId, ws);

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
          connectionId
        );
        this.onStateChange?.();
        return;
      }

      case "propose_products": {
        const participant = this.store.getParticipant(connectionId);
        if (!participant) {
          this.send(ws, {
            type: "error",
            code: "NOT_JOINED",
            message: "Debes ingresar con un nombre antes de proponer productos.",
          });
          return;
        }

        // Operación asíncrona sin bloquear el Event Loop ni a los demás usuarios
        void this.handleProposal(ws, participant, msg.productIds);
        return;
      }

      case "vote": {
        const result = this.store.voteProduct(connectionId, msg.productId);
        if (!result.ok) {
          this.send(ws, {
            type: "error",
            code: result.code,
            message: result.message,
          });
          return;
        }

        this.broadcastProducts();
        return;
      }

      case "unvote": {
        const result = this.store.unvoteProduct(connectionId, msg.productId);
        if (!result.ok) {
          this.send(ws, {
            type: "error",
            code: result.code,
            message: result.message,
          });
          return;
        }

        this.broadcastProducts();
        return;
      }

      case "remove_product": {
        const result = this.store.removeProduct(connectionId, msg.productId);
        if (!result.ok) {
          this.send(ws, {
            type: "error",
            code: result.code,
            message: result.message,
          });
          return;
        }

        this.broadcastProducts();
        return;
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
    for (const client of this.wss.clients) {
      client.terminate();
    }
    this.joinedSockets.clear();
    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }
}
