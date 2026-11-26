import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { DummyJsonCatalogClient, type CatalogClient } from "./catalogClient.js";
import type { AppConfig } from "./config.js";
import { DEFAULT_ROOM_CODE, normalizeRoomCode, RoomManager } from "./roomManager.js";
import { SseBroker } from "./sseBroker.js";
import { StaticFileServer } from "./staticFiles.js";
import type { GiftListStore } from "./store.js";
import { WsGateway, type StateChangeListener } from "./wsGateway.js";

export interface AppOverrides {
  store?: GiftListStore;
  catalogClient?: CatalogClient;
  onStateChange?: StateChangeListener;
  clientDistDir?: string;
}

export interface GiftListApp {
  httpServer: Server;
  wsGateway: WsGateway;
  sseBroker: SseBroker;
  roomManager: RoomManager;
  store: GiftListStore;
  close(): Promise<void>;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Compone todas las dependencias del servidor en un único servidor HTTP/WebSocket/SSE (DIP + SRP).
 */
export function createGiftListApp(config: AppConfig, overrides: AppOverrides = {}): GiftListApp {
  const catalogClient =
    overrides.catalogClient ??
    new DummyJsonCatalogClient({
      baseUrl: config.catalogUrl,
      timeoutMs: config.catalogTimeoutMs,
      delayMs: config.catalogDelayMs,
    });
  const roomManager = new RoomManager(catalogClient, overrides.store);
  const sseBroker = new SseBroker(roomManager);
  const staticFiles = new StaticFileServer(
    overrides.clientDistDir ?? resolve(process.cwd(), "dist/client")
  );

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (method === "GET" && url.pathname === "/events") {
      const roomCode = normalizeRoomCode(url.searchParams.get("room"));
      if (!roomCode) {
        sendJson(res, 400, {
          error: "Código de lista inválido. Debe tener entre 2 y 20 caracteres alfanuméricos o guiones.",
        });
        return;
      }
      sseBroker.handleRequest(req, res, roomCode);
      return;
    }

    if (method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        status: "ok",
        config: {
          host: config.host,
          port: config.port,
          catalogUrl: config.catalogUrl,
          catalogTimeoutMs: config.catalogTimeoutMs,
          catalogDelayMs: config.catalogDelayMs,
          wsHeartbeatMs: config.wsHeartbeatMs,
        },
        stats: {
          rooms: roomManager.getRoomCount(),
          participants: roomManager.getTotalParticipantCount(),
          products: roomManager.getTotalProductCount(),
          sseClients: sseBroker.getClientCount(),
        },
      });
      return;
    }

    if (method === "GET" && staticFiles.tryServe(url.pathname, res)) {
      return;
    }

    sendJson(res, 404, {
      error: "Ruta no encontrada",
      path: url.pathname,
    });
  });

  const wsGateway = new WsGateway({
    httpServer,
    roomManager,
    path: "/ws",
    heartbeatIntervalMs: config.wsHeartbeatMs,
    onStateChange: (roomCode) => {
      sseBroker.broadcastState(roomCode);
      overrides.onStateChange?.(roomCode);
    },
  });

  return {
    httpServer,
    wsGateway,
    sseBroker,
    roomManager,
    store: roomManager.getOrCreateRoom(DEFAULT_ROOM_CODE).store,
    async close(): Promise<void> {
      sseBroker.closeAll();
      await wsGateway.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
