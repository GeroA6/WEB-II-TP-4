import type { IncomingMessage, ServerResponse } from "node:http";
import type { ScreenStateEvent } from "../../shared/protocol.js";
import { DEFAULT_ROOM_CODE, type ReadOnlyRoomProvider } from "./roomManager.js";

/**
 * Broker de Server-Sent Events para clientes de tipo Pantalla agrupados por sala (SRP + ISP + DIP).
 * Depende únicamente de ReadOnlyRoomProvider (solo lectura).
 */
export class SseBroker {
  private readonly roomProvider: ReadOnlyRoomProvider;
  private readonly clientsByRoom = new Map<string, Set<ServerResponse>>();

  constructor(roomProvider: ReadOnlyRoomProvider) {
    this.roomProvider = roomProvider;
  }

  handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    roomCode: string = DEFAULT_ROOM_CODE
  ): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.flushHeaders();

    let roomClients = this.clientsByRoom.get(roomCode);
    if (!roomClients) {
      roomClients = new Set<ServerResponse>();
      this.clientsByRoom.set(roomCode, roomClients);
    }
    roomClients.add(res);

    // Envía el estado actual de esa sala de inmediato al conectar la pantalla
    this.writePayload(roomCode, res, this.buildStateFrame(roomCode));

    const cleanup = () => {
      const set = this.clientsByRoom.get(roomCode);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          this.clientsByRoom.delete(roomCode);
        }
      }
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  }

  broadcastState(roomCode: string = DEFAULT_ROOM_CODE): void {
    const roomClients = this.clientsByRoom.get(roomCode);
    if (!roomClients || roomClients.size === 0) {
      return;
    }

    const frame = this.buildStateFrame(roomCode);
    for (const res of Array.from(roomClients)) {
      this.writePayload(roomCode, res, frame);
    }
  }

  getClientCount(roomCode?: string): number {
    if (roomCode !== undefined) {
      return this.clientsByRoom.get(roomCode)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.clientsByRoom.values()) {
      total += set.size;
    }
    return total;
  }

  closeAll(): void {
    for (const set of this.clientsByRoom.values()) {
      for (const res of set) {
        if (!res.writableEnded) {
          res.end();
        }
      }
    }
    this.clientsByRoom.clear();
  }

  private buildStateFrame(roomCode: string): string {
    const readOnlyList = this.roomProvider.getReadOnlyList(roomCode);
    const payload: ScreenStateEvent = {
      roomCode,
      products: readOnlyList.getSortedProducts(),
      participantCount: readOnlyList.getParticipantCount(),
    };
    return `event: state\ndata: ${JSON.stringify(payload)}\n\n`;
  }

  private writePayload(roomCode: string, res: ServerResponse, frame: string): void {
    if (res.writableEnded || res.destroyed) {
      const set = this.clientsByRoom.get(roomCode);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          this.clientsByRoom.delete(roomCode);
        }
      }
      return;
    }
    res.write(frame);
  }
}
