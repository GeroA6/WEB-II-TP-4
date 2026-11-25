import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { get as httpGet, type ClientRequest, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import type { ScreenStateEvent } from "../../shared/protocol.js";
import { createGiftListApp } from "./app.js";
import type { CatalogClient, CatalogFetchResult } from "./catalogClient.js";
import type { AppConfig } from "./config.js";

const BASE_CONFIG: AppConfig = {
  port: 0,
  catalogUrl: "https://dummyjson.com/products",
  catalogTimeoutMs: 3000,
  catalogDelayMs: 0,
};

interface ParsedSseEvent {
  event: string;
  data: ScreenStateEvent;
}

class SseTestClient {
  private readonly req: ClientRequest;
  private readonly res: IncomingMessage;
  private buffer = "";
  private readonly queue: ParsedSseEvent[] = [];
  private readonly waiters: Array<{
    predicate: (ev: ParsedSseEvent) => boolean;
    resolve: (ev: ParsedSseEvent) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  private constructor(req: ClientRequest, res: IncomingMessage) {
    this.req = req;
    this.res = res;

    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      this.buffer += chunk;
      let sepIndex = this.buffer.indexOf("\n\n");
      while (sepIndex !== -1) {
        const block = this.buffer.slice(0, sepIndex);
        this.buffer = this.buffer.slice(sepIndex + 2);
        this.processBlock(block);
        sepIndex = this.buffer.indexOf("\n\n");
      }
    });
  }

  static connect(port: number): Promise<SseTestClient> {
    return new Promise((resolve, reject) => {
      const req = httpGet(`http://127.0.0.1:${port}/events`, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE devolvió status ${res.statusCode}`));
          return;
        }
        resolve(new SseTestClient(req, res));
      });
      req.on("error", reject);
    });
  }

  private processBlock(block: string): void {
    let event = "message";
    let dataLine = "";

    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLine += line.slice("data:".length).trim();
      }
    }

    if (!dataLine) return;

    const parsed: ParsedSseEvent = {
      event,
      data: JSON.parse(dataLine) as ScreenStateEvent,
    };

    const idx = this.waiters.findIndex((w) => w.predicate(parsed));
    if (idx !== -1) {
      const [waiter] = this.waiters.splice(idx, 1);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(parsed);
      }
      return;
    }

    this.queue.push(parsed);
  }

  nextEvent(
    predicate: (ev: ParsedSseEvent) => boolean = () => true,
    timeoutMs = 1500
  ): Promise<ParsedSseEvent> {
    const idx = this.queue.findIndex(predicate);
    if (idx !== -1) {
      const [ev] = this.queue.splice(idx, 1);
      if (ev) {
        return Promise.resolve(ev);
      }
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout (${timeoutMs}ms) esperando evento SSE.`));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  close(): void {
    this.req.destroy();
    this.res.destroy();
  }
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

describe("SseBroker - integración Pantalla SSE + Participantes WebSocket", () => {
  it("envía estado inicial inmediato y refleja en vivo ingresos, propuestas, votos y desconexiones", async () => {
    const fakeCatalog: CatalogClient = {
      async fetchProduct(productId: number): Promise<CatalogFetchResult> {
        return {
          ok: true,
          product: {
            id: productId,
            title: `Regalo #${productId}`,
            price: 99,
            thumbnail: `https://img.test/${productId}.jpg`,
          },
        };
      },
    };

    const app = createGiftListApp(BASE_CONFIG, { catalogClient: fakeCatalog });
    await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = app.httpServer.address() as AddressInfo;

    const screen = await SseTestClient.connect(port);
    const ws = await connectWs(port);

    try {
      // 1. Estado inicial al abrir la pantalla
      const initial = await screen.nextEvent();
      assert.equal(initial.event, "state");
      assert.equal(initial.data.participantCount, 0);
      assert.deepEqual(initial.data.products, []);

      // 2. Entra un participante por WebSocket -> la pantalla actualiza participantCount
      ws.send(JSON.stringify({ type: "join", name: "Lucía" }));
      const afterJoin = await screen.nextEvent((ev) => ev.data.participantCount === 1);
      assert.equal(afterJoin.data.participantCount, 1);

      // 3. Participante propone producto #1 -> la pantalla recibe el producto
      ws.send(JSON.stringify({ type: "propose_products", productIds: [1] }));
      const afterProposal = await screen.nextEvent((ev) => ev.data.products.length === 1);
      assert.equal(afterProposal.data.products[0]?.title, "Regalo #1");
      assert.equal(afterProposal.data.products[0]?.voteCount, 0);

      // 4. Participante vota producto #1 -> la pantalla actualiza el ranking
      ws.send(JSON.stringify({ type: "vote", productId: 1 }));
      const afterVote = await screen.nextEvent((ev) => ev.data.products[0]?.voteCount === 1);
      assert.equal(afterVote.data.products[0]?.voteCount, 1);

      // 5. Participante cierra la pestaña -> la pantalla ve 0 participantes
      ws.close();
      const afterLeave = await screen.nextEvent((ev) => ev.data.participantCount === 0);
      assert.equal(afterLeave.data.participantCount, 0);
    } finally {
      ws.close();
      screen.close();
      await app.close();
    }
  });

  it("limpia los recursos cuando la pantalla cierra su conexión SSE", async () => {
    const app = createGiftListApp(BASE_CONFIG);
    await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = app.httpServer.address() as AddressInfo;

    const screen = await SseTestClient.connect(port);
    try {
      await screen.nextEvent();
      assert.equal(app.sseBroker.getClientCount(), 1);

      screen.close();
      // Esperamos un breve instante a que Node procese el evento 'close' del socket
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(app.sseBroker.getClientCount(), 0);
    } finally {
      await app.close();
    }
  });
});
