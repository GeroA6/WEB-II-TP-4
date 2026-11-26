import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { ClientMessage, Participant, ServerMessage } from "../../shared/protocol.js";
import { normalizeRoomCode, type RoomContext, type RoomManager } from "./roomManager.js";
import { parseClientMessage } from "./validation.js";

export type StateChangeListener = (roomCode: string) => void;

export interface WsGatewayDependencies {
  httpServer: Server;
  roomManager: RoomManager;
  path?: string;
  heartbeatIntervalMs?: number;
  onStateChange?: StateChangeListener;
}

/**
 * Capa de transporte WebSocket para participantes (SRP + OCP).
 * Comparte el mismo servidor HTTP y puerto, aísla sesiones y broadcasts por código de lista (?room=...),
 * detecta conexiones muertas mediante ping/pong y notifica cambios de estado por sala.
 */
export class WsGateway {
  private readonly wss: WebSocketServer;
  private readonly roomManager: RoomManager;
  private readonly socketsByRoom = new Map<string, Map<string, WebSocket>>();
  private readonly aliveState = new WeakMap<WebSocket, boolean>();
  private readonly onStateChange?: StateChangeListener;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(deps: WsGatewayDependencies) {
    this.roomManager = deps.roomManager;
    this.onStateChange = deps.onStateChange;

    this.wss = new WebSocketServer({
      server: deps.httpServer,
      path: deps.path ?? "/ws",
    });

    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));

    const heartbeatMs = deps.heartbeatIntervalMs ?? 15000;
    if (heartbeatMs > 0) {
      this.heartbeatTimer = setInterval(() => this.runHeartbeat(), heartbeatMs);
    }
  }

  private runHeartbeat(): void {
    for (const ws of this.wss.clients) {
      if (this.aliveState.get(ws) === false) {
        ws.terminate();
        continue;
      }
      this.aliveState.set(ws, false);
      ws.ping();
    }
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? "/ws", `http://${req.headers.host ?? "localhost"}`);
    const roomCode = normalizeRoomCode(url.searchParams.get("room"));

    if (!roomCode) {
      this.send(ws, {
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Código de lista inválido. Debe tener entre 2 y 20 caracteres alfanuméricos o guiones.",
      });
      ws.close(1008, "Invalid room code");
      return;
    }

    const room = this.roomManager.getOrCreateRoom(roomCode);
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

      sessionId = this.handleMessage(ws, room, sessionId, parsed.value);
    });

    ws.on("close", () => {
      if (sessionId !== null) {
        this.cleanupConnection(room, sessionId);
        sessionId = null;
      }
    });

    ws.on("error", () => {
      if (sessionId !== null) {
        this.cleanupConnection(room, sessionId);
        sessionId = null;
      }
    });
  }

  private handleMessage(
    ws: WebSocket,
    room: RoomContext,
    currentSessionId: string | null,
    msg: ClientMessage
  ): string | null {
    const roomSockets = this.getOrCreateRoomSockets(room.code);

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

        const candidateId =
          msg.participantId &&
          !roomSockets.has(msg.participantId) &&
          !room.store.getParticipant(msg.participantId)
            ? msg.participantId
            : randomUUID();

        const result = room.store.joinParticipant(candidateId, msg.name);
        if (!result.ok) {
          this.send(ws, {
            type: "error",
            code: result.code,
            message: result.message,
          });
          return null;
        }

        roomSockets.set(candidateId, ws);

        this.send(ws, {
          type: "welcome",
          roomCode: room.code,
          self: result.value,
          participants: room.store.getParticipants(),
          products: room.store.getSortedProducts(),
        });

        this.broadcastToRoom(
          room.code,
          {
            type: "participants_updated",
            participants: room.store.getParticipants(),
          },
          candidateId
        );
        this.onStateChange?.(room.code);
        return candidateId;
      }

      case "propose_products": {
        const participant =
          currentSessionId !== null ? room.store.getParticipant(currentSessionId) : undefined;
        if (!participant) {
          this.send(ws, {
            type: "error",
            code: "NOT_JOINED",
            message: "Debes ingresar con un nombre antes de proponer productos.",
          });
          return currentSessionId;
        }

        void this.handleProposal(ws, room, participant, msg.productIds);
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
        const result = room.store.voteProduct(currentSessionId, msg.productId);
        if (!result.ok) {
          this.send(ws, {
            type: "error",
            code: result.code,
            message: result.message,
          });
          return currentSessionId;
        }

        this.broadcastProducts(room);
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
        const result = room.store.unvoteProduct(currentSessionId, msg.productId);
        if (!result.ok) {
          this.send(ws, {
            type: "error",
            code: result.code,
            message: result.message,
          });
          return currentSessionId;
        }

        this.broadcastProducts(room);
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
        const result = room.store.removeProduct(currentSessionId, msg.productId);
        if (!result.ok) {
          this.send(ws, {
            type: "error",
            code: result.code,
            message: result.message,
          });
          return currentSessionId;
        }

        this.broadcastProducts(room);
        return currentSessionId;
      }
    }
  }

  private async handleProposal(
    ws: WebSocket,
    room: RoomContext,
    proposer: Participant,
    productIds: number[]
  ): Promise<void> {
    try {
      const outcome = await room.proposalService.proposeProducts(proposer, productIds);

      if (outcome.addedIds.length > 0) {
        this.broadcastProducts(room);
      }

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

  private broadcastProducts(room: RoomContext): void {
    this.broadcastToRoom(room.code, {
      type: "products_updated",
      products: room.store.getSortedProducts(),
    });
    this.onStateChange?.(room.code);
  }

  private cleanupConnection(room: RoomContext, sessionId: string): void {
    const roomSockets = this.socketsByRoom.get(room.code);
    if (roomSockets) {
      roomSockets.delete(sessionId);
      if (roomSockets.size === 0) {
        this.socketsByRoom.delete(room.code);
      }
    }

    const removed = room.store.leaveParticipant(sessionId);
    if (removed) {
      this.broadcastToRoom(room.code, {
        type: "participants_updated",
        participants: room.store.getParticipants(),
      });
      this.onStateChange?.(room.code);
    }
  }

  private getOrCreateRoomSockets(roomCode: string): Map<string, WebSocket> {
    let sockets = this.socketsByRoom.get(roomCode);
    if (!sockets) {
      sockets = new Map<string, WebSocket>();
      this.socketsByRoom.set(roomCode, sockets);
    }
    return sockets;
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcastToRoom(
    roomCode: string,
    message: ServerMessage,
    excludeSessionId?: string
  ): void {
    const sockets = this.socketsByRoom.get(roomCode);
    if (!sockets) {
      return;
    }

    const payload = JSON.stringify(message);
    for (const [id, socket] of sockets.entries()) {
      if (id === excludeSessionId) {
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
    this.socketsByRoom.clear();
    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }
}
