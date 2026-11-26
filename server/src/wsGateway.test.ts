import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import type { ServerMessage } from "../../shared/protocol.js";
import { createGiftListApp } from "./app.js";
import type { CatalogClient, CatalogFetchResult } from "./catalogClient.js";
import type { AppConfig } from "./config.js";

const BASE_CONFIG: AppConfig = {
  host: "127.0.0.1",
  port: 0,
  catalogUrl: "https://dummyjson.com/products",
  catalogTimeoutMs: 3000,
  catalogDelayMs: 0,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TestWsClient {
  private readonly ws: WebSocket;
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: Array<{
    predicate: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString("utf8")) as ServerMessage;
      const waiterIndex = this.waiters.findIndex((w) => w.predicate(msg));
      if (waiterIndex !== -1) {
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(msg);
        }
        return;
      }
      this.queue.push(msg);
    });
  }

  static connect(port: number): Promise<TestWsClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.once("open", () => resolve(new TestWsClient(ws)));
      ws.once("error", reject);
    });
  }

  sendRaw(raw: string): void {
    this.ws.send(raw);
  }

  sendJson(payload: unknown): void {
    this.ws.send(JSON.stringify(payload));
  }

  nextMessage(
    predicate: (msg: ServerMessage) => boolean = () => true,
    timeoutMs = 1500
  ): Promise<ServerMessage> {
    const queuedIndex = this.queue.findIndex(predicate);
    if (queuedIndex !== -1) {
      const [msg] = this.queue.splice(queuedIndex, 1);
      if (msg) {
        return Promise.resolve(msg);
      }
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout (${timeoutMs}ms) esperando mensaje WebSocket.`));
      }, timeoutMs);

      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  drainMessages(): ServerMessage[] {
    return this.queue.splice(0, this.queue.length);
  }

  close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }
}

describe("WsGateway - integración HTTP + WebSocket en un único puerto", () => {
  it("envía estado completo al entrar tarde, sincroniza fallos parciales solo al autor y actualiza desconexiones", async () => {
    const fakeCatalog: CatalogClient = {
      async fetchProduct(productId: number): Promise<CatalogFetchResult> {
        if (productId === 1) {
          return {
            ok: true,
            product: { id: 1, title: "Cafetera", price: 150, thumbnail: "https://img/1.jpg" },
          };
        }
        return { ok: false, reason: "not_found", message: `Producto #${productId} inexistente` };
      },
    };

    const app = createGiftListApp(BASE_CONFIG, { catalogClient: fakeCatalog });
    await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = app.httpServer.address() as AddressInfo;

    const ana = await TestWsClient.connect(port);
    const juan = await TestWsClient.connect(port);

    try {
      // Ana entra y propone [1, 999] (1 válido, 999 inexistente)
      ana.sendJson({ type: "join", name: "Ana" });
      const anaWelcome = await ana.nextMessage((m) => m.type === "welcome");
      assert.equal(anaWelcome.type, "welcome");

      ana.sendJson({ type: "propose_products", productIds: [1, 999] });
      const anaProducts = await ana.nextMessage((m) => m.type === "products_updated");
      const anaResult = await ana.nextMessage((m) => m.type === "proposal_result");

      assert.equal(anaProducts.type, "products_updated");
      if (anaProducts.type === "products_updated") {
        assert.equal(anaProducts.products.length, 1);
        assert.equal(anaProducts.products[0]?.title, "Cafetera");
      }

      assert.equal(anaResult.type, "proposal_result");
      if (anaResult.type === "proposal_result") {
        assert.deepEqual(anaResult.addedIds, [1]);
        assert.equal(anaResult.failures.length, 1);
        assert.equal(anaResult.failures[0]?.reason, "not_found");
      }

      // Juan entra tarde: debe ver a Ana y el producto #1 sin esperar cambios
      juan.sendJson({ type: "join", name: "Juan" });
      const juanWelcome = await juan.nextMessage((m) => m.type === "welcome");
      const anaSeesJuan = await ana.nextMessage((m) => m.type === "participants_updated");

      assert.equal(juanWelcome.type, "welcome");
      if (juanWelcome.type === "welcome") {
        assert.equal(juanWelcome.participants.length, 2);
        assert.equal(juanWelcome.products.length, 1);
      }

      assert.equal(anaSeesJuan.type, "participants_updated");
      if (anaSeesJuan.type === "participants_updated") {
        assert.equal(anaSeesJuan.participants.length, 2);
      }

      // Juan propone [999]: el error solo lo recibe Juan, no Ana
      juan.sendJson({ type: "propose_products", productIds: [999] });
      const juanResult = await juan.nextMessage((m) => m.type === "proposal_result");
      assert.equal(juanResult.type, "proposal_result");
      await sleep(30);
      assert.deepEqual(ana.drainMessages(), []);

      // Juan cierra la pestaña -> Ana ve solo 1 participante
      await juan.close();
      const afterLeave = await ana.nextMessage((m) => m.type === "participants_updated");
      assert.equal(afterLeave.type, "participants_updated");
      if (afterLeave.type === "participants_updated") {
        assert.equal(afterLeave.participants.length, 1);
        assert.equal(afterLeave.participants[0]?.name, "Ana");
      }
    } finally {
      await ana.close();
      await juan.close();
      await app.close();
    }
  });

  it("no bloquea los votos de otros participantes mientras espera un catálogo lento", async () => {
    const fakeCatalog: CatalogClient = {
      async fetchProduct(productId: number): Promise<CatalogFetchResult> {
        if (productId === 1) {
          return {
            ok: true,
            product: { id: 1, title: "Mate", price: 40, thumbnail: "https://img/1.jpg" },
          };
        }
        // Producto #2 simula catálogo lento (160ms)
        await sleep(160);
        return {
          ok: true,
          product: { id: 2, title: "Termo", price: 120, thumbnail: "https://img/2.jpg" },
        };
      },
    };

    const app = createGiftListApp(BASE_CONFIG, { catalogClient: fakeCatalog });
    await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = app.httpServer.address() as AddressInfo;

    const ana = await TestWsClient.connect(port);
    const juan = await TestWsClient.connect(port);

    try {
      ana.sendJson({ type: "join", name: "Ana" });
      await ana.nextMessage((m) => m.type === "welcome");

      juan.sendJson({ type: "join", name: "Juan" });
      await juan.nextMessage((m) => m.type === "welcome");
      await ana.nextMessage((m) => m.type === "participants_updated");

      // Primero agregamos producto rápido #1
      ana.sendJson({ type: "propose_products", productIds: [1] });
      await ana.nextMessage((m) => m.type === "products_updated");
      await ana.nextMessage((m) => m.type === "proposal_result");
      await juan.nextMessage((m) => m.type === "products_updated");

      // Ana dispara propuesta lenta #2 (160ms)
      const start = performance.now();
      ana.sendJson({ type: "propose_products", productIds: [2] });

      // Inmediatamente Juan vota el producto #1 y debe recibir actualización sin esperar los 160ms
      juan.sendJson({ type: "vote", productId: 1 });
      const voteBroadcast = await juan.nextMessage(
        (m) => m.type === "products_updated" && m.products[0]?.voteCount === 1
      );
      const voteElapsed = performance.now() - start;

      assert.equal(voteBroadcast.type, "products_updated");
      assert.ok(
        voteElapsed < 100,
        `El voto de Juan no debería esperar al catálogo lento (tardó ${voteElapsed.toFixed(1)}ms)`
      );

      // Luego llega la propuesta lenta #2 de Ana
      const slowResult = await ana.nextMessage((m) => m.type === "proposal_result");
      assert.equal(slowResult.type, "proposal_result");
      if (slowResult.type === "proposal_result") {
        assert.deepEqual(slowResult.addedIds, [2]);
      }
    } finally {
      await ana.close();
      await juan.close();
      await app.close();
    }
  });

  it("envía error solo al emisor ante mensajes inválidos y mantiene el servidor funcionando", async () => {
    const app = createGiftListApp(BASE_CONFIG);
    await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = app.httpServer.address() as AddressInfo;

    const ana = await TestWsClient.connect(port);
    const juan = await TestWsClient.connect(port);

    try {
      ana.sendJson({ type: "join", name: "Ana" });
      await ana.nextMessage((m) => m.type === "welcome");

      // Juan envía JSON malformado y un tipo desconocido (como desde consola del navegador)
      juan.sendRaw("{esto no es json");
      const err1 = await juan.nextMessage((m) => m.type === "error");
      assert.equal(err1.type, "error");
      if (err1.type === "error") {
        assert.equal(err1.code, "INVALID_JSON");
      }

      juan.sendJson({ type: "accion_inventada", foo: "bar" });
      const err2 = await juan.nextMessage((m) => m.type === "error");
      assert.equal(err2.type, "error");
      if (err2.type === "error") {
        assert.equal(err2.code, "UNKNOWN_MESSAGE_TYPE");
      }

      // Ana no recibió ninguno de esos errores y Juan aún puede unirse normalmente
      await sleep(30);
      assert.deepEqual(ana.drainMessages(), []);

      juan.sendJson({ type: "join", name: "Juan" });
      const juanWelcome = await juan.nextMessage((m) => m.type === "welcome");
      assert.equal(juanWelcome.type, "welcome");
    } finally {
      await ana.close();
      await juan.close();
      await app.close();
    }
  });

  it("permite reconectar conservando participantId, votos previos y permiso de autor para quitar productos", async () => {
    const fakeCatalog: CatalogClient = {
      async fetchProduct(productId: number): Promise<CatalogFetchResult> {
        return {
          ok: true,
          product: { id: productId, title: "Mochila", price: 85, thumbnail: "https://img/1.jpg" },
        };
      },
    };

    const app = createGiftListApp(BASE_CONFIG, { catalogClient: fakeCatalog });
    await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = app.httpServer.address() as AddressInfo;

    const ana1 = await TestWsClient.connect(port);
    let ana2: TestWsClient | null = null;

    try {
      ana1.sendJson({ type: "join", name: "Ana" });
      const w1 = await ana1.nextMessage((m) => m.type === "welcome");
      assert.equal(w1.type, "welcome");
      if (w1.type !== "welcome") return;
      const originalId = w1.self.id;

      // Ana propone #1 y lo vota
      ana1.sendJson({ type: "propose_products", productIds: [1] });
      await ana1.nextMessage((m) => m.type === "products_updated");
      await ana1.nextMessage((m) => m.type === "proposal_result");

      ana1.sendJson({ type: "vote", productId: 1 });
      await ana1.nextMessage((m) => m.type === "products_updated");

      // Se corta la conexión de Ana (servidor sigue encendido)
      await ana1.close();
      await sleep(30);

      // Ana reconecta enviando su participantId anterior
      ana2 = await TestWsClient.connect(port);
      ana2.sendJson({ type: "join", name: "Ana", participantId: originalId });
      const w2 = await ana2.nextMessage((m) => m.type === "welcome");
      assert.equal(w2.type, "welcome");
      if (w2.type !== "welcome") return;

      assert.equal(w2.self.id, originalId);
      assert.equal(w2.products.length, 1);
      assert.ok(w2.products[0]?.voterIds.includes(originalId));

      // No puede volver a votar el producto que ya votó antes de desconectarse
      ana2.sendJson({ type: "vote", productId: 1 });
      const dupVote = await ana2.nextMessage((m) => m.type === "error");
      assert.equal(dupVote.type, "error");
      if (dupVote.type === "error") {
        assert.equal(dupVote.code, "INVALID_VOTE_ACTION");
      }

      // Conserva el permiso de autor para quitar su propio producto
      ana2.sendJson({ type: "remove_product", productId: 1 });
      const afterRemove = await ana2.nextMessage((m) => m.type === "products_updated");
      assert.equal(afterRemove.type, "products_updated");
      if (afterRemove.type === "products_updated") {
        assert.equal(afterRemove.products.length, 0);
      }
    } finally {
      await ana1.close();
      await ana2?.close();
      await app.close();
    }
  });
});
