import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseClientMessage } from "./validation.js";

describe("parseClientMessage - validación defensiva", () => {
  it("acepta un mensaje join válido y recorta espacios sobrantes", () => {
    const result = parseClientMessage(JSON.stringify({ type: "join", name: "  Lucía  " }));
    assert.deepEqual(result, {
      ok: true,
      value: { type: "join", name: "Lucía" },
    });
  });

  it("acepta propose_products con 1 a 10 enteros positivos", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = parseClientMessage(
      JSON.stringify({ type: "propose_products", productIds: ids })
    );
    assert.deepEqual(result, {
      ok: true,
      value: { type: "propose_products", productIds: ids },
    });
  });

  it("acepta mensajes explícitos vote, unvote y remove_product", () => {
    for (const type of ["vote", "unvote", "remove_product"] as const) {
      const result = parseClientMessage(JSON.stringify({ type, productId: 42 }));
      assert.deepEqual(result, {
        ok: true,
        value: { type, productId: 42 },
      });
    }
  });

  it("rechaza JSON malformado sin lanzar excepciones", () => {
    const result = parseClientMessage("{invalido");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "INVALID_JSON");
    }
  });

  it("rechaza mensajes que no son objetos JSON", () => {
    for (const raw of ["123", "null", '["join"]', '"hola"']) {
      const result = parseClientMessage(raw);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "INVALID_MESSAGE");
      }
    }
  });

  it("rechaza tipos desconocidos", () => {
    const result = parseClientMessage(JSON.stringify({ type: "hack_server" }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "UNKNOWN_MESSAGE_TYPE");
    }
  });

  it("rechaza nombres vacíos, muy cortos o muy largos", () => {
    for (const name of ["", "   ", "A", "A".repeat(21), 123]) {
      const result = parseClientMessage(JSON.stringify({ type: "join", name }));
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "INVALID_NAME");
      }
    }
  });

  it("rechaza propose_products vacío, con más de 10 IDs o con IDs no enteros positivos", () => {
    const cases = [
      [],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      [0],
      [-5],
      [1.5],
      ["1"],
      "no-es-array",
    ];

    for (const productIds of cases) {
      const result = parseClientMessage(
        JSON.stringify({ type: "propose_products", productIds })
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "INVALID_MESSAGE");
      }
    }
  });

  it("rechaza vote/unvote/remove_product con productId inválido", () => {
    for (const productId of [undefined, 0, -1, 2.5, "10"]) {
      const result = parseClientMessage(JSON.stringify({ type: "vote", productId }));
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "INVALID_MESSAGE");
      }
    }
  });
});
