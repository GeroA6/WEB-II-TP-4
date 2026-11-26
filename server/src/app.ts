import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { DummyJsonCatalogClient, type CatalogClient } from "./catalogClient.js";
import type { AppConfig } from "./config.js";
import { ProposalService } from "./proposalService.js";
import { SseBroker } from "./sseBroker.js";
import { StaticFileServer } from "./staticFiles.js";
import { GiftListStore } from "./store.js";
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
  const sseBroker = new SseBroker(store);
  const staticFiles = new StaticFileServer(
    overrides.clientDistDir ?? resolve(process.cwd(), "dist/client")
  );

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (method === "GET" && url.pathname === "/events") {
      sseBroker.handleRequest(req, res);
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
        },
        stats: {
          participants: store.getParticipantCount(),
          products: store.getSortedProducts().length,
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
    store,
    proposalService,
    path: "/ws",
    onStateChange: () => {
      sseBroker.broadcastState();
      overrides.onStateChange?.();
    },
  });

  return {
    httpServer,
    wsGateway,
    sseBroker,
    store,
    async close(): Promise<void> {
      sseBroker.closeAll();
      await wsGateway.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
