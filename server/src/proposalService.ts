import type { Participant, ProposalFailure } from "../../shared/protocol.js";
import type { CatalogClient } from "./catalogClient.js";
import type { GiftListStore } from "./store.js";

export interface ProposalOutcome {
  addedIds: number[];
  failures: ProposalFailure[];
}

/**
 * Coordina la propuesta de hasta 10 productos en simultáneo (SRP + DIP):
 * 1. Reserva síncronamente cada ID en el store (evita duplicados concurrentes).
 * 2. Consulta todos los IDs reservados en paralelo con Promise.allSettled.
 * 3. Confirma los exitosos y libera la reserva de los fallidos.
 */
export class ProposalService {
  private readonly store: GiftListStore;
  private readonly catalogClient: CatalogClient;

  constructor(store: GiftListStore, catalogClient: CatalogClient) {
    this.store = store;
    this.catalogClient = catalogClient;
  }

  async proposeProducts(
    proposer: Participant,
    productIds: number[]
  ): Promise<ProposalOutcome> {
    const addedIds: number[] = [];
    const failures: ProposalFailure[] = [];
    const reservedIds: number[] = [];

    // Fase 1: reserva síncrona atómica antes de cualquier await
    for (const productId of productIds) {
      if (!this.store.tryReserveProductId(productId)) {
        failures.push({
          productId,
          reason: "already_exists",
          message: `El producto #${productId} ya está en la lista o está siendo agregado.`,
        });
        continue;
      }
      reservedIds.push(productId);
    }

    if (reservedIds.length === 0) {
      return { addedIds, failures };
    }

    // Fase 2: consultas al catálogo en simultáneo, tolerando fallos individuales
    const settledResults = await Promise.allSettled(
      reservedIds.map(async (productId) => ({
        productId,
        result: await this.catalogClient.fetchProduct(productId),
      }))
    );

    // Fase 3: confirmar exitosos o liberar reservas de los fallidos
    settledResults.forEach((settled, index) => {
      const productId = reservedIds[index];
      if (productId === undefined) {
        return;
      }

      if (settled.status === "rejected") {
        this.store.releaseProductReservation(productId);
        failures.push({
          productId,
          reason: "catalog_error",
          message: `Error inesperado al consultar el producto #${productId}.`,
        });
        return;
      }

      const { result } = settled.value;
      if (result.ok) {
        this.store.commitProduct(result.product, proposer);
        addedIds.push(productId);
      } else {
        this.store.releaseProductReservation(productId);
        failures.push({
          productId,
          reason: result.reason,
          message: result.message,
        });
      }
    });

    return { addedIds, failures };
  }
}
