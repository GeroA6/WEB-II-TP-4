import type { ErrorCode, Participant, ProductItem } from "../../shared/protocol.js";

export type DomainResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; message: string };

export interface CatalogProductData {
  id: number;
  title: string;
  price: number;
  thumbnail: string;
}

/**
 * Estrategia inyectable para decidir quién puede quitar un producto (OCP).
 */
export type RemovalPolicy = (product: ProductItem, requesterId: string) => boolean;

export const onlyProposerCanRemove: RemovalPolicy = (product, requesterId) =>
  product.proposedById === requesterId;

/**
 * Interfaz segregada de solo lectura para consumidores que no mutan estado,
 * como el emisor de Server-Sent Events de la pantalla (ISP).
 */
export interface ReadOnlyGiftList {
  getParticipants(): Participant[];
  getParticipantCount(): number;
  getSortedProducts(): ProductItem[];
}

interface StoredProduct {
  id: number;
  title: string;
  price: number;
  thumbnail: string;
  proposedById: string;
  proposedByName: string;
  voterIds: Set<string>;
  createdOrder: number;
}

export class GiftListStore implements ReadOnlyGiftList {
  private readonly participants = new Map<string, Participant>();
  private readonly activeNamesNormalized = new Set<string>();
  private readonly products = new Map<number, StoredProduct>();
  private readonly inFlightProductIds = new Set<number>();
  private readonly removalPolicy: RemovalPolicy;
  private nextProductOrder = 1;

  constructor(removalPolicy: RemovalPolicy = onlyProposerCanRemove) {
    this.removalPolicy = removalPolicy;
  }

  joinParticipant(participantId: string, name: string): DomainResult<Participant> {
    if (this.participants.has(participantId)) {
      return {
        ok: false,
        code: "ALREADY_JOINED",
        message: "Esta conexión ya ingresó con un nombre.",
      };
    }

    const normalized = name.toLowerCase();
    if (this.activeNamesNormalized.has(normalized)) {
      return {
        ok: false,
        code: "NAME_TAKEN",
        message: `El nombre "${name}" ya está en uso por otro participante conectado.`,
      };
    }

    const participant: Participant = { id: participantId, name };
    this.participants.set(participantId, participant);
    this.activeNamesNormalized.add(normalized);

    return { ok: true, value: { ...participant } };
  }

  leaveParticipant(participantId: string): Participant | null {
    const existing = this.participants.get(participantId);
    if (!existing) {
      return null;
    }

    this.participants.delete(participantId);
    this.activeNamesNormalized.delete(existing.name.toLowerCase());
    return { ...existing };
  }

  getParticipant(participantId: string): Participant | undefined {
    const participant = this.participants.get(participantId);
    return participant ? { ...participant } : undefined;
  }

  getParticipants(): Participant[] {
    return Array.from(this.participants.values(), (p) => ({ ...p }));
  }

  getParticipantCount(): number {
    return this.participants.size;
  }

  /**
   * Reserva de forma síncrona un productId antes de consultar al catálogo externo.
   * Evita condiciones de carrera cuando dos participantes proponen el mismo ID a la vez.
   */
  tryReserveProductId(productId: number): boolean {
    if (this.products.has(productId) || this.inFlightProductIds.has(productId)) {
      return false;
    }

    this.inFlightProductIds.add(productId);
    return true;
  }

  /**
   * Confirma un producto previamente reservado una vez que el catálogo respondió con éxito.
   */
  commitProduct(data: CatalogProductData, proposer: Participant): ProductItem {
    this.inFlightProductIds.delete(data.id);

    const stored: StoredProduct = {
      id: data.id,
      title: data.title,
      price: data.price,
      thumbnail: data.thumbnail,
      proposedById: proposer.id,
      proposedByName: proposer.name,
      voterIds: new Set<string>(),
      createdOrder: this.nextProductOrder++,
    };

    this.products.set(data.id, stored);
    return this.toProductItem(stored);
  }

  /**
   * Libera la reserva si la consulta al catálogo falló o venció el timeout,
   * permitiendo volver a proponer ese ID más adelante.
   */
  releaseProductReservation(productId: number): void {
    this.inFlightProductIds.delete(productId);
  }

  voteProduct(participantId: string, productId: number): DomainResult<ProductItem> {
    if (!this.participants.has(participantId)) {
      return {
        ok: false,
        code: "NOT_JOINED",
        message: "Debes ingresar con un nombre antes de votar.",
      };
    }

    const product = this.products.get(productId);
    if (!product) {
      return {
        ok: false,
        code: "PRODUCT_NOT_FOUND",
        message: `El producto #${productId} no está en la lista.`,
      };
    }

    if (product.voterIds.has(participantId)) {
      return {
        ok: false,
        code: "INVALID_VOTE_ACTION",
        message: "Ya votaste este producto.",
      };
    }

    product.voterIds.add(participantId);
    return { ok: true, value: this.toProductItem(product) };
  }

  unvoteProduct(participantId: string, productId: number): DomainResult<ProductItem> {
    if (!this.participants.has(participantId)) {
      return {
        ok: false,
        code: "NOT_JOINED",
        message: "Debes ingresar con un nombre antes de retirar un voto.",
      };
    }

    const product = this.products.get(productId);
    if (!product) {
      return {
        ok: false,
        code: "PRODUCT_NOT_FOUND",
        message: `El producto #${productId} no está en la lista.`,
      };
    }

    if (!product.voterIds.has(participantId)) {
      return {
        ok: false,
        code: "INVALID_VOTE_ACTION",
        message: "No habías votado este producto.",
      };
    }

    product.voterIds.delete(participantId);
    return { ok: true, value: this.toProductItem(product) };
  }

  removeProduct(participantId: string, productId: number): DomainResult<ProductItem> {
    if (!this.participants.has(participantId)) {
      return {
        ok: false,
        code: "NOT_JOINED",
        message: "Debes ingresar con un nombre antes de quitar productos.",
      };
    }

    const product = this.products.get(productId);
    if (!product) {
      return {
        ok: false,
        code: "PRODUCT_NOT_FOUND",
        message: `El producto #${productId} no está en la lista.`,
      };
    }

    const snapshot = this.toProductItem(product);
    if (!this.removalPolicy(snapshot, participantId)) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "Solo quien propuso este producto puede quitarlo de la lista.",
      };
    }

    this.products.delete(productId);
    return { ok: true, value: snapshot };
  }

  getSortedProducts(): ProductItem[] {
    return Array.from(this.products.values())
      .sort((a, b) => {
        const voteDiff = b.voterIds.size - a.voterIds.size;
        if (voteDiff !== 0) {
          return voteDiff;
        }
        return a.createdOrder - b.createdOrder;
      })
      .map((product) => this.toProductItem(product));
  }

  private toProductItem(product: StoredProduct): ProductItem {
    return {
      id: product.id,
      title: product.title,
      price: product.price,
      thumbnail: product.thumbnail,
      proposedById: product.proposedById,
      proposedByName: product.proposedByName,
      voterIds: Array.from(product.voterIds),
      voteCount: product.voterIds.size,
    };
  }
}
