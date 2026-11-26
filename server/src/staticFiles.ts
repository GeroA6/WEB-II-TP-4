import { existsSync, readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

const SPA_ROUTES = new Set(["/", "/pantalla", "/pantalla/"]);

/**
 * Sirve el build estático de React desde el mismo servidor HTTP y puerto (SRP).
 * Protege contra path traversal y resuelve las rutas SPA "/" y "/pantalla".
 */
export class StaticFileServer {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  tryServe(pathname: string, res: ServerResponse): boolean {
    if (!existsSync(this.rootDir)) {
      return false;
    }

    const relativePath = SPA_ROUTES.has(pathname)
      ? "index.html"
      : pathname.replace(/^\/+/, "");

    const targetPath = resolve(join(this.rootDir, relativePath));
    // Seguridad: evitar salir del directorio raíz de estáticos
    if (!targetPath.startsWith(this.rootDir)) {
      return false;
    }

    if (!existsSync(targetPath) || !statSync(targetPath).isFile()) {
      return false;
    }

    const content = readFileSync(targetPath);
    const contentType = MIME_TYPES[extname(targetPath)] ?? "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.byteLength,
    });
    res.end(content);
    return true;
  }
}
