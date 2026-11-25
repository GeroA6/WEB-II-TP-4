import type { CatalogProductData } from "./store.js";

export type CatalogErrorReason = "not_found" | "timeout" | "catalog_error";

export type CatalogFetchResult =
  | { ok: true; product: CatalogProductData }
  | { ok: false; reason: CatalogErrorReason; message: string };

/**
 * Abstracción del cliente de catálogo externo (DIP / LSP).
 * Permite sustituir la implementación real de DummyJSON por dobles de prueba
 * sin modificar el servicio de propuestas.
 */
export interface CatalogClient {
  fetchProduct(productId: number): Promise<CatalogFetchResult>;
}

export interface DummyJsonCatalogClientConfig {
  baseUrl: string;
  timeoutMs: number;
  delayMs: number;
}

interface DummyJsonRawProduct {
  id?: unknown;
  title?: unknown;
  price?: unknown;
  thumbnail?: unknown;
  images?: unknown;
}

export class DummyJsonCatalogClient implements CatalogClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly delayMs: number;

  constructor(config: DummyJsonCatalogClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs;
    this.delayMs = config.delayMs;
  }

  async fetchProduct(productId: number): Promise<CatalogFetchResult> {
    const url = new URL(`${this.baseUrl}/${productId}`);
    if (this.delayMs > 0) {
      url.searchParams.set("delay", String(this.delayMs));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });

      if (response.status === 404) {
        return {
          ok: false,
          reason: "not_found",
          message: `El producto #${productId} no existe en el catálogo.`,
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          reason: "catalog_error",
          message: `El catálogo respondió con error HTTP ${response.status} para el producto #${productId}.`,
        };
      }

      const raw = (await response.json()) as DummyJsonRawProduct;
      const product = this.mapProduct(productId, raw);
      if (!product) {
        return {
          ok: false,
          reason: "catalog_error",
          message: `El catálogo devolvió datos incompletos para el producto #${productId}.`,
        };
      }

      return { ok: true, product };
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        return {
          ok: false,
          reason: "timeout",
          message: `El catálogo no respondió a tiempo (${this.timeoutMs}ms) para el producto #${productId}.`,
        };
      }

      return {
        ok: false,
        reason: "catalog_error",
        message: `No se pudo consultar el catálogo para el producto #${productId}.`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private mapProduct(productId: number, raw: DummyJsonRawProduct): CatalogProductData | null {
    if (typeof raw.title !== "string" || typeof raw.price !== "number") {
      return null;
    }

    let thumbnail = "";
    if (typeof raw.thumbnail === "string" && raw.thumbnail.trim() !== "") {
      thumbnail = raw.thumbnail;
    } else if (Array.isArray(raw.images) && typeof raw.images[0] === "string") {
      thumbnail = raw.images[0];
    }

    return {
      id: productId,
      title: raw.title,
      price: raw.price,
      thumbnail,
    };
  }
}
