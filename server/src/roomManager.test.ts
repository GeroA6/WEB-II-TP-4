import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { get as httpGet } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import type { ScreenStateEvent, ServerMessage } from "../../shared/protocol.js";
import { createGiftListApp } from "./app.js";
import type { CatalogClient, CatalogFetchResult } from "./catalogClient.js";
import type { AppConfig } from "./config.js";
import { DEFAULT_ROOM_CODE, normalizeRoomCode } from "./roomManager.js";

const BASE_CONFIG: AppConfig = {
  host: "127.0.0.1",
  port: 0,
  catalogUrl: "https://dummyjson.com/products",
  catalogTimeoutMs: 3000,
  catalogDelayMs: 0,
  wsHeartbeatMs: 0,
};

function connectWsRoom(port: number, roomCode: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${encodeURIComponent(roomCode)}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextWsMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString("utf8")) as ServerMessage));
  });
}

function readFirstSseEvent(port: number, roomCode: string): Promise<ScreenStateEvent> {
  return new Promise((resolve, reject) => {
    const req = httpGet(`http://127.0.0.1:${port}/events?room=${encodeURIComponent(roomCode)}`, (res) => {
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        const end = buffer.indexOf("\n\n");
        if (end !== -1) {
          const block = buffer.slice(0, end);
          const dataLine = block
            .split("\n")
            .find((l) => l.startsWith("data:"))
            ?.slice("data:".length)
            .trim();
          req.destroy();
          res.destroy();
          if (dataLine) {
            resolve(JSON.parse(dataLine) as ScreenStateEvent);
          } else {
            reject(new Error("Evento SSE sin data"));
          }
        }
      });
    });
    req.on("error", reject);
  });
}

describe("RoomManager - varias listas independientes por código", () => {
  it("normaliza códigos válidos y usa GENERAL por defecto", () => {
    assert.equal(normalizeRoomCode(undefined), DEFAULT_ROOM_CODE);
    assert.equal(normalizeRoomCode(""), DEFAULT_ROOM_CODE);
    assert.equal(normalizeRoomCode("  cumple-ana "), "CUMPLE-ANA");
    assert.equal(normalizeRoomCode("A"), null);
    assert.equal(normalizeRoomCode("SALA CON ESPACIOS"), null);
  });

  it("mantiene completamente aislados participantes, productos y SSE entre dos salas distintas", async () => {
    const fakeCatalog: CatalogClient = {
      async fetchProduct(productId: number): Promise<CatalogFetchResult> {
        return {
          ok: true,
          product: { id: productId, title: `Item ${productId}`, price: 50, thumbnail: "" },
        };
      },
    };

    const app = createGiftListApp(BASE_CONFIG, { catalogClient: fakeCatalog });
    await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = app.httpServer.address() as AddressInfo;

    const wsA = await connectWsRoom(port, "SALA-A");
    const wsB = await connectWsRoom(port, "SALA-B");

    try {
      // El mismo nombre "Ana" puede existir a la vez en SALA-A y SALA-B
      const pA = nextWsMessage(wsA);
      wsA.send(JSON.stringify({ type: "join", name: "Ana" }));
      const welcomeA = await pA;
      assert.equal(welcomeA.type, "welcome");
      if (welcomeA.type === "welcome") {
        assert.equal(welcomeA.roomCode, "SALA-A");
      }

      const pB = nextWsMessage(wsB);
      wsB.send(JSON.stringify({ type: "join", name: "Ana" }));
      const welcomeB = await pB;
      assert.equal(welcomeB.type, "welcome");
      if (welcomeB.type === "welcome") {
        assert.equal(welcomeB.roomCode, "SALA-B");
      }

      // Ana en SALA-A propone producto #1
      const prodUpdatedA = nextWsMessage(wsA);
      wsA.send(JSON.stringify({ type: "propose_products", productIds: [1] }));
      await prodUpdatedA;

      // La pantalla SSE de SALA-A ve 1 producto y 1 participante; la de SALA-B ve 0 productos
      const sseA = await readFirstSseEvent(port, "SALA-A");
      const sseB = await readFirstSseEvent(port, "SALA-B");

      assert.equal(sseA.roomCode, "SALA-A");
      assert.equal(sseA.participantCount, 1);
      assert.equal(sseA.products.length, 1);

      assert.equal(sseB.roomCode, "SALA-B");
      assert.equal(sseB.participantCount, 1);
      assert.equal(sseB.products.length, 0);
    } finally {
      wsA.close();
      wsB.close();
      await app.close();
    }
  });
});
