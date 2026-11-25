# Módulo 2 — Contrato de Mensajes y Validación en TypeScript

## 1. Objetivo del módulo
Diseñar el **contrato tipado de mensajes** compartido entre el servidor y el futuro frontend en React, e implementar la **validación defensiva en tiempo de ejecución** en el servidor bajo el principio de *"el servidor decide"* (ningún mensaje inválido puede corromper el estado ni hacer caer el proceso).

---

## 2. Qué hicimos

- `shared/protocol.ts`: define los tipos del contrato completo:
  - **Modelos:** `Participant`, `ProductItem`, `ProposalFailure`, `ProposalFailureReason`, `ErrorCode`.
  - **Cliente → Servidor (WebSocket):** `join`, `propose_products`, `vote`, `unvote`, `remove_product` agrupados en la unión discriminada `ClientMessage`.
  - **Servidor → Participante (WebSocket):** `welcome`, `participants_updated`, `products_updated`, `proposal_result`, `error` agrupados en `ServerMessage`.
  - **Servidor → Pantalla (SSE):** `ScreenStateEvent` (`products` + `participantCount`).
- `server/src/validation.ts`: implementa `validateParticipantName()` y `parseClientMessage(rawText)` devolviendo un resultado tipado `ValidationResult<ClientMessage>` sin lanzar excepciones no controladas.
- `server/src/validation.test.ts`: suite de 9 pruebas automatizadas con `node:test` y `node:assert/strict` cubriendo casos válidos e inválidos.
- `package.json`: se agregó el script `npm test`.

---

## 3. Decisiones tomadas y por qué

- **Uniones discriminadas (*Discriminated Unions*) por el campo `type`:**
  - *Por qué:* TypeScript puede inferir automáticamente qué campos existen en cada rama de un `switch (msg.type)` tanto en el servidor como en React, evitando errores de tipeo y accesos a propiedades inexistentes.
- **Mensajes explícitos `vote` y `unvote` en lugar de un único `toggle_vote`:**
  - *Por qué:* son más claros en el contrato y seguros ante concurrencia o doble clic accidental. Si un cliente envía dos veces `vote` por error, la intención sigue siendo "quiero votar" (idempotente), en vez de votar y desvotar sin querer.
- **Patrón `Result` (`{ ok: true, value } | { ok: false, code, message }`) en lugar de lanzar excepciones:**
  - *Por qué:* un mensaje inválido enviado por un cliente no es un fallo inesperado del sistema, sino un caso normal de flujo. Devolver un objeto `Result` obliga al servidor a manejar ambos caminos explícitamente y garantiza que nunca se caiga el proceso por un JSON malformado.
- **Carpeta `shared/`:**
  - *Por qué:* permite que el backend y el frontend React (Módulo 7) importen exactamente las mismas interfaces del protocolo, manteniendo una única fuente de verdad.

---

## 4. Cómo funciona

1. **Tipos en compilación vs. datos en ejecución:** TypeScript desaparece cuando se compila a JavaScript. Por la red (WebSocket) solo viaja texto plano. Por eso, todo lo que llega entra como `string` y pasa primero por `parseClientMessage()`.
2. **Embudo de validación defensiva:**
   1. `JSON.parse` dentro de `try/catch` → si falla, devuelve `INVALID_JSON`.
   2. Se verifica que sea un objeto plano (no `null`, no array, no primitivo) → si falla, `INVALID_MESSAGE`.
   3. Se valida que `type` sea un string no vacío y coincida con un caso conocido → si no, `UNKNOWN_MESSAGE_TYPE`.
   4. Cada caso valida sus campos específicos:
      - `join`: recorta espacios (`trim`) y exige entre 2 y 20 caracteres (`INVALID_NAME`).
      - `propose_products`: exige un arreglo de 1 a 10 enteros positivos (`INVALID_MESSAGE`).
      - `vote`, `unvote`, `remove_product`: exigen `productId` entero positivo (`INVALID_MESSAGE`).
3. Solo si supera todos los filtros se entrega un `ClientMessage` fuertemente tipado al resto del servidor.

---

## 5. Verificación realizada

- `npm run typecheck` → sin errores de tipos.
- `npx tsx --test server/src/validation.test.ts` → **9/9 pruebas aprobadas** (mensajes válidos, recorte de espacios, JSON malformado, no-objetos, tipos desconocidos, nombres fuera de rango, propuestas vacías o >10 IDs, e IDs negativos/decimales/texto).
