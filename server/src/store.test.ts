import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GiftListStore, type CatalogProductData } from "./store.js";

function makeProduct(id: number, title = `Producto ${id}`): CatalogProductData {
  return {
    id,
    title,
    price: 100 * id,
    thumbnail: `https://example.com/${id}.jpg`,
  };
}

describe("GiftListStore - estado en memoria y reglas de negocio", () => {
  it("acepta participantes con nombres únicos y rechaza duplicados sin distinguir mayúsculas", () => {
    const store = new GiftListStore();

    const first = store.joinParticipant("p1", "Ana");
    assert.equal(first.ok, true);

    const duplicate = store.joinParticipant("p2", "ana");
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) {
      assert.equal(duplicate.code, "NAME_TAKEN");
    }

    const sameConn = store.joinParticipant("p1", "Otro");
    assert.equal(sameConn.ok, false);
    if (!sameConn.ok) {
      assert.equal(sameConn.code, "ALREADY_JOINED");
    }
  });

  it("libera el nombre cuando un participante se desconecta", () => {
    const store = new GiftListStore();

    store.joinParticipant("p1", "Carlos");
    assert.equal(store.getParticipantCount(), 1);

    const left = store.leaveParticipant("p1");
    assert.deepEqual(left, { id: "p1", name: "Carlos" });
    assert.equal(store.getParticipantCount(), 0);

    const rejoined = store.joinParticipant("p2", "carlos");
    assert.equal(rejoined.ok, true);
  });

  it("evita duplicados concurrentes mediante reserva síncrona en vuelo", () => {
    const store = new GiftListStore();
    const p1 = store.joinParticipant("p1", "Ana");
    assert.equal(p1.ok, true);

    // Dos propuestas simultáneas del mismo producto #5
    assert.equal(store.tryReserveProductId(5), true);
    assert.equal(store.tryReserveProductId(5), false);

    // Si falla el catálogo, liberar la reserva permite reintentar luego
    store.releaseProductReservation(5);
    assert.equal(store.tryReserveProductId(5), true);

    if (p1.ok) {
      store.commitProduct(makeProduct(5), p1.value);
    }

    // Una vez confirmado, tampoco puede volver a reservarse
    assert.equal(store.tryReserveProductId(5), false);
    assert.equal(store.getSortedProducts().length, 1);
  });

  it("permite votar una vez, retirar voto, contar votos simultáneos y ordenar por ranking", () => {
    const store = new GiftListStore();
    const p1 = store.joinParticipant("p1", "Ana");
    const p2 = store.joinParticipant("p2", "Juan");
    assert.equal(p1.ok && p2.ok, true);
    if (!p1.ok || !p2.ok) return;

    store.tryReserveProductId(1);
    store.commitProduct(makeProduct(1, "Auriculares"), p1.value);
    store.tryReserveProductId(2);
    store.commitProduct(makeProduct(2, "Teclado"), p2.value);

    // Dos votos sobre el producto #2 (ambos se contabilizan)
    assert.equal(store.voteProduct("p1", 2).ok, true);
    assert.equal(store.voteProduct("p2", 2).ok, true);

    // Segundo voto del mismo participante es rechazado
    const doubleVote = store.voteProduct("p1", 2);
    assert.equal(doubleVote.ok, false);
    if (!doubleVote.ok) {
      assert.equal(doubleVote.code, "INVALID_VOTE_ACTION");
    }

    // Producto #2 debe quedar primero en el ranking
    const ranked = store.getSortedProducts();
    assert.equal(ranked[0]?.id, 2);
    assert.equal(ranked[0]?.voteCount, 2);
    assert.equal(ranked[1]?.id, 1);
    assert.equal(ranked[1]?.voteCount, 0);

    // Retirar voto reduce el contador
    const unvoted = store.unvoteProduct("p1", 2);
    assert.equal(unvoted.ok, true);
    if (unvoted.ok) {
      assert.equal(unvoted.value.voteCount, 1);
    }
  });

  it("permite quitar un producto solo a quien lo propuso y soporta políticas personalizadas (OCP)", () => {
    const store = new GiftListStore();
    const p1 = store.joinParticipant("p1", "Ana");
    const p2 = store.joinParticipant("p2", "Juan");
    assert.equal(p1.ok && p2.ok, true);
    if (!p1.ok || !p2.ok) return;

    store.tryReserveProductId(10);
    store.commitProduct(makeProduct(10, "Cafetera"), p1.value);

    // Juan no puede quitar el producto de Ana
    const forbidden = store.removeProduct("p2", 10);
    assert.equal(forbidden.ok, false);
    if (!forbidden.ok) {
      assert.equal(forbidden.code, "FORBIDDEN");
    }

    // Ana sí puede quitarlo
    const removed = store.removeProduct("p1", 10);
    assert.equal(removed.ok, true);
    assert.equal(store.getSortedProducts().length, 0);

    // Verificación OCP: política alternativa inyectada (solo si tiene 0 votos)
    const zeroVotesStore = new GiftListStore((product) => product.voteCount === 0);
    const u1 = zeroVotesStore.joinParticipant("u1", "Sofía");
    assert.equal(u1.ok, true);
    if (!u1.ok) return;
    zeroVotesStore.tryReserveProductId(20);
    zeroVotesStore.commitProduct(makeProduct(20, "Libro"), u1.value);
    zeroVotesStore.voteProduct("u1", 20);
    assert.equal(zeroVotesStore.removeProduct("u1", 20).ok, false);
  });
});
