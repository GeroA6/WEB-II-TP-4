import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGiftListApp } from "./app.js";
import type { AppConfig } from "./config.js";

const BASE_CONFIG: AppConfig = {
  port: 0,
  catalogUrl: "https://dummyjson.com/products",
  catalogTimeoutMs: 3000,
  catalogDelayMs: 0,
};

describe("StaticFileServer - servido de React en el mismo puerto", () => {
  it("sirve index.html en / y /pantalla y bloquea path traversal", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tp4-client-"));
    writeFileSync(join(tempDir, "index.html"), "<!doctype html><html><body>TP4 App</body></html>");

    const app = createGiftListApp(BASE_CONFIG, { clientDistDir: tempDir });
    await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = app.httpServer.address() as AddressInfo;

    try {
      const rootRes = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(rootRes.status, 200);
      assert.match(rootRes.headers.get("content-type") ?? "", /text\/html/);
      assert.match(await rootRes.text(), /TP4 App/);

      const screenRes = await fetch(`http://127.0.0.1:${port}/pantalla`);
      assert.equal(screenRes.status, 200);
      assert.match(await screenRes.text(), /TP4 App/);

      const traversalRes = await fetch(`http://127.0.0.1:${port}/../package.json`);
      assert.equal(traversalRes.status, 404);
    } finally {
      await app.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
