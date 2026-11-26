import type { CatalogClient } from "./catalogClient.js";
import { ProposalService } from "./proposalService.js";
import { GiftListStore, type ReadOnlyGiftList } from "./store.js";

export const DEFAULT_ROOM_CODE = "GENERAL";

const ROOM_CODE_REGEX = /^[A-Z0-9-]{2,20}$/;

/**
 * Normaliza y valida el código de lista (sala).
 * Si viene vacío u omitido, utiliza la sala por defecto "GENERAL" para mantener retrocompatibilidad.
 */
export function normalizeRoomCode(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return DEFAULT_ROOM_CODE;
  }
  const normalized = raw.trim().toUpperCase();
  return ROOM_CODE_REGEX.test(normalized) ? normalized : null;
}

export interface RoomContext {
  code: string;
  store: GiftListStore;
  proposalService: ProposalService;
}

/**
 * Interfaz segregada de solo lectura por sala para SseBroker (ISP + DIP).
 */
export interface ReadOnlyRoomProvider {
  getReadOnlyList(roomCode: string): ReadOnlyGiftList;
}

/**
 * Administra múltiples listas independientes por código (SRP + OCP).
 * Reutiliza GiftListStore y ProposalService sin modificarlos: cada sala es 100% aislada.
 */
export class RoomManager implements ReadOnlyRoomProvider {
  private readonly rooms = new Map<string, RoomContext>();
  private readonly catalogClient: CatalogClient;

  constructor(catalogClient: CatalogClient, defaultStore?: GiftListStore) {
    this.catalogClient = catalogClient;
    if (defaultStore) {
      this.rooms.set(DEFAULT_ROOM_CODE, {
        code: DEFAULT_ROOM_CODE,
        store: defaultStore,
        proposalService: new ProposalService(defaultStore, catalogClient),
      });
    }
  }

  getOrCreateRoom(roomCode: string): RoomContext {
    let room = this.rooms.get(roomCode);
    if (!room) {
      const store = new GiftListStore();
      room = {
        code: roomCode,
        store,
        proposalService: new ProposalService(store, this.catalogClient),
      };
      this.rooms.set(roomCode, room);
    }
    return room;
  }

  getReadOnlyList(roomCode: string): ReadOnlyGiftList {
    return this.getOrCreateRoom(roomCode).store;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getTotalParticipantCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) {
      total += room.store.getParticipantCount();
    }
    return total;
  }

  getTotalProductCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) {
      total += room.store.getSortedProducts().length;
    }
    return total;
  }
}
