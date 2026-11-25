import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DummyJsonCatalogClient, type CatalogClient } from "./catalogClient.js";
import type { AppConfig } from "./config.js";
import { ProposalService } from "./proposalService.js";
import { GiftListStore } from "./store.js";
import { WsGateway, type StateChangeListener } from "./wsGateway.js";

export interface AppOverrides {
  store?: GiftListStore;
  catalogClient?: CatalogClient;
  onStateChange?: StateChangeListener;
}

export interface GiftListApp {
  httpServer: Server;
  wsGateway: WsGateway;
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
 * Compone todas las dependencias del servidor en un único servidor HTTP/WebSocket (DIP + SRP).
 */
export function createGiftListApp(config: AppConfig, overrides: AppOverrides = {}): GiftListApp {
  const store = overrides.store ?? new GiftListStore();
  const catalogClient =
    overrides.catalogClient ??
    new DummyJsonCatalogClient({
      baseUrl: config.catalogUrl,
      timeoutMs: config.catalogTimeoutMs,
      delayMs: config.catalogDelayMs,
    });
  const proposalService = new ProposalService(store, catalogClient);

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        status: "ok",
        config: {
          port: config.port,
          catalogUrl: config.catalogUrl,
          catalogTimeoutMs: config.catalogTimeoutMs,
          catalogDelayMs: config.catalogDelayMs,
        },
        stats: {
          participants: store.getParticipantCount(),
          products: store.getSortedProducts().length,
        },
      });
      return;
    }

    sendJson(res, 404, {
      error: "Ruta no encontrada",
      path: url.pathname,
    });
  });

  const wsGateway = new WsGateway({
    httpServer,
    store,
    proposalService,
    path: "/ws",
    onStateChange: overrides.onStateChange,
  });

  return {
    httpServer,
    wsGateway,
    store,
    async close(): Promise<void> {
      await wsGateway.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
