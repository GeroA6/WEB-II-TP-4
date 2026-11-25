import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DummyJsonCatalogClient,
  type CatalogClient,
  type CatalogFetchResult,
} from "./catalogClient.js";
import { ProposalService } from "./proposalService.js";
import { GiftListStore } from "./store.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ProposalService - concurrencia y tolerancia a fallos parciales", () => {
  it("consulta múltiples productos en simultáneo y no de forma secuencial", async () => {
    const store = new GiftListStore();
    const joined = store.joinParticipant("p1", "Ana");
    assert.equal(joined.ok, true);
    if (!joined.ok) return;

    const fakeCatalog: CatalogClient = {
      async fetchProduct(productId: number): Promise<CatalogFetchResult> {
        await delay(60);
        return {
          ok: true,
          product: {
            id: productId,
            title: `Producto ${productId}`,
            price: productId * 10,
            thumbnail: `https://img.test/${productId}.png`,
          },
        };
      },
    };

    const service = new ProposalService(store, fakeCatalog);
    const start = performance.now();
    const outcome = await service.proposeProducts(joined.value, [1, 2, 3]);
    const elapsedMs = performance.now() - start;

    assert.deepEqual(outcome.addedIds, [1, 2, 3]);
    assert.deepEqual(outcome.failures, []);
    // En serie tardaría >= 180ms; en paralelo debe rondar ~60ms
    assert.ok(elapsedMs < 150, `Esperaba ejecución paralela (<150ms), tardó ${elapsedMs.toFixed(1)}ms`);
  });

  it("maneja fallos parciales (válido, inexistente, timeout, error y duplicado) y libera reservas fallidas", async () => {
    const store = new GiftListStore();
    const joined = store.joinParticipant("p1", "Ana");
    assert.equal(joined.ok, true);
    if (!joined.ok) return;

    const fakeCatalog: CatalogClient = {
      async fetchProduct(productId: number): Promise<CatalogFetchResult> {
        if (productId === 1) {
          return {
            ok: true,
            product: { id: 1, title: "Mouse", price: 50, thumbnail: "https://img.test/1.png" },
          };
        }
        if (productId === 2) {
          return { ok: false, reason: "timeout", message: "Timeout" };
        }
        if (productId === 999) {
          return { ok: false, reason: "not_found", message: "No existe" };
        }
        return { ok: false, reason: "catalog_error", message: "Error HTTP 500" };
      },
    };

    const service = new ProposalService(store, fakeCatalog);
    const outcome = await service.proposeProducts(joined.value, [1, 2, 999, 500, 1]);

    assert.deepEqual(outcome.addedIds, [1]);
    assert.equal(outcome.failures.length, 4);

    const reasonsById = new Map(outcome.failures.map((f) => [f.productId, f.reason]));
    assert.equal(reasonsById.get(1), "already_exists");
    assert.equal(reasonsById.get(2), "timeout");
    assert.equal(reasonsById.get(999), "not_found");
    assert.equal(reasonsById.get(500), "catalog_error");

    // El ID 2 que falló por timeout debe haberse liberado para poder reintentarse
    assert.equal(store.tryReserveProductId(2), true);
    store.releaseProductReservation(2);
  });

  it("evita duplicados cuando dos participantes proponen el mismo producto casi al mismo tiempo", async () => {
    const store = new GiftListStore();
    const ana = store.joinParticipant("p1", "Ana");
    const juan = store.joinParticipant("p2", "Juan");
    assert.equal(ana.ok && juan.ok, true);
    if (!ana.ok || !juan.ok) return;

    let fetchCount = 0;
    const fakeCatalog: CatalogClient = {
      async fetchProduct(productId: number): Promise<CatalogFetchResult> {
        fetchCount++;
        await delay(40);
        return {
          ok: true,
          product: { id: productId, title: "Teclado", price: 120, thumbnail: "https://img.test/7.png" },
        };
      },
    };

    const service = new ProposalService(store, fakeCatalog);
    const [resAna, resJuan] = await Promise.all([
      service.proposeProducts(ana.value, [7]),
      service.proposeProducts(juan.value, [7]),
    ]);

    assert.equal(fetchCount, 1);
    assert.deepEqual(resAna.addedIds, [7]);
    assert.equal(resJuan.addedIds.length, 0);
    assert.equal(resJuan.failures[0]?.reason, "already_exists");
    assert.equal(store.getSortedProducts().length, 1);
  });
});

describe("DummyJsonCatalogClient - integración HTTP y AbortController", () => {
  it("maneja 200 OK, 404 not_found, 500 catalog_error, timeout real y parámetro delay", async () => {
    let lastRequestedDelay: string | null = null;

    const mockServer = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      lastRequestedDelay = url.searchParams.get("delay");

      if (url.pathname === "/products/1") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: 1,
            title: "Auriculares Pro",
            price: 199,
            thumbnail: "https://cdn.test/1.jpg",
          })
        );
        return;
      }

      if (url.pathname === "/products/404") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Product with id '404' not found" }));
        return;
      }

      if (url.pathname === "/products/500") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Internal error" }));
        return;
      }

      if (url.pathname === "/products/99") {
        // Respuesta lenta para disparar AbortController
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id: 99, title: "Lento", price: 10, thumbnail: "" }));
          }
        }, 250);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
    const { port } = mockServer.address() as AddressInfo;

    try {
      const client = new DummyJsonCatalogClient({
        baseUrl: `http://127.0.0.1:${port}/products`,
        timeoutMs: 80,
        delayMs: 123,
      });

      const okRes = await client.fetchProduct(1);
      assert.equal(okRes.ok, true);
      if (okRes.ok) {
        assert.equal(okRes.product.title, "Auriculares Pro");
        assert.equal(okRes.product.price, 199);
        assert.equal(okRes.product.thumbnail, "https://cdn.test/1.jpg");
      }
      assert.equal(lastRequestedDelay, "123");

      const notFoundRes = await client.fetchProduct(404);
      assert.equal(notFoundRes.ok, false);
      if (!notFoundRes.ok) {
        assert.equal(notFoundRes.reason, "not_found");
      }

      const errorRes = await client.fetchProduct(500);
      assert.equal(errorRes.ok, false);
      if (!errorRes.ok) {
        assert.equal(errorRes.reason, "catalog_error");
      }

      const timeoutRes = await client.fetchProduct(99);
      assert.equal(timeoutRes.ok, false);
      if (!timeoutRes.ok) {
        assert.equal(timeoutRes.reason, "timeout");
      }
    } finally {
      mockServer.close();
    }
  });
});
