import type { IncomingMessage, ServerResponse } from "node:http";
import type { ScreenStateEvent } from "../../shared/protocol.js";
import type { ReadOnlyGiftList } from "./store.js";

/**
 * Broker de Server-Sent Events para clientes de tipo Pantalla (SRP + ISP + DIP).
 * Depende únicamente de ReadOnlyGiftList (solo lectura) y gestiona conexiones
 * HTTP unidireccionales text/event-stream.
 */
export class SseBroker {
  private readonly readOnlyList: ReadOnlyGiftList;
  private readonly clients = new Set<ServerResponse>();

  constructor(readOnlyList: ReadOnlyGiftList) {
    this.readOnlyList = readOnlyList;
  }

  handleRequest(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.flushHeaders();

    this.clients.add(res);

    // Envía el estado actual de inmediato al conectar la pantalla
    this.writePayload(res, this.buildStateFrame());

    const cleanup = () => {
      this.clients.delete(res);
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  }

  broadcastState(): void {
    if (this.clients.size === 0) {
      return;
    }

    const frame = this.buildStateFrame();
    for (const res of Array.from(this.clients)) {
      this.writePayload(res, frame);
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  closeAll(): void {
    for (const res of this.clients) {
      if (!res.writableEnded) {
        res.end();
      }
    }
    this.clients.clear();
  }

  private buildStateFrame(): string {
    const payload: ScreenStateEvent = {
      products: this.readOnlyList.getSortedProducts(),
      participantCount: this.readOnlyList.getParticipantCount(),
    };
    return `event: state\ndata: ${JSON.stringify(payload)}\n\n`;
  }

  private writePayload(res: ServerResponse, frame: string): void {
    if (res.writableEnded || res.destroyed) {
      this.clients.delete(res);
      return;
    }
    res.write(frame);
  }
}
