import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig, type AppConfig } from "./config.js";

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function createAppServer(config: AppConfig) {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
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
      });
      return;
    }

    sendJson(res, 404, {
      error: "Ruta no encontrada",
      path: url.pathname,
    });
  });
}

const config = loadConfig();
const server = createAppServer(config);

server.listen(config.port, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port}`);
  console.log(
    `Catálogo: ${config.catalogUrl} | Timeout: ${config.catalogTimeoutMs}ms | Delay simulado: ${config.catalogDelayMs}ms`
  );
});
