# Módulo 3 — Estado en Memoria y Reglas de Negocio

## 1. Objetivo del módulo
Implementar la capa de **dominio y estado en memoria** (`GiftListStore`) de forma completamente desacoplada de la red (HTTP/WebSocket/SSE), aplicando las reglas de negocio definidas en el Módulo 1, principios **SOLID** y protección ante **condiciones de carrera** (*race conditions*) en operaciones concurrentes.

---

## 2. Qué hicimos

- `server/src/store.ts`:
  - `GiftListStore`: administra en memoria participantes conectados (`Map`), nombres activos normalizados (`Set`), productos propuestos (`Map`), votos por producto (`Set`) e IDs "en vuelo" (`inFlightProductIds: Set<number>`).
  - `RemovalPolicy` y `onlyProposerCanRemove`: estrategia inyectable que decide quién puede eliminar un producto.
  - `ReadOnlyGiftList`: interfaz segregada de solo lectura para consumidores que solo observan el estado (como la pantalla SSE en el Módulo 6).
  - Operaciones tipadas con `DomainResult<T>`: `joinParticipant`, `leaveParticipant`, `tryReserveProductId`, `commitProduct`, `releaseProductReservation`, `voteProduct`, `unvoteProduct`, `removeProduct`, `getParticipants`, `getParticipantCount`, `getSortedProducts`.
- `server/src/store.test.ts`: suite de 5 pruebas unitarias que verifican reglas de nombres, desconexión, reserva en vuelo, votos simultáneos, ranking y políticas de eliminación.

---

## 3. Decisiones tomadas y principios SOLID aplicados

- **SRP (Responsabilidad Única):** `GiftListStore` solo gestiona estado en memoria y reglas del dominio. No conoce `WebSocket`, `IncomingMessage` ni `fetch`, por lo que se puede probar sin levantar ningún servidor.
- **OCP (Abierto/Cerrado):** la regla de eliminación se recibe como una función `RemovalPolicy` en el constructor (con default `onlyProposerCanRemove`). Si mañana se decidiera permitir borrar solo productos con 0 votos, se inyecta otra política sin modificar `GiftListStore`.
- **ISP (Segregación de Interfaces):** `ReadOnlyGiftList` expone únicamente los métodos de consulta (`getParticipants`, `getParticipantCount`, `getSortedProducts`) para que módulos de solo lectura (SSE) no dependan de métodos de escritura.
- **Snapshots inmutables al exterior:** métodos como `getParticipants()` y `getSortedProducts()` devuelven copias nuevas (y convierten `Set` a `Array`) para que ningún consumidor externo pueda mutar el estado interno por accidente.
- **Desempate determinístico en el ranking:** los productos se ordenan por `voteCount` descendente y, ante empate de votos, por orden de creación (`createdOrder` ascendente) para evitar que la lista "salte" arbitrariamente.
- **Conservación de votos al salir:** si un participante cierra la pestaña, se libera su nombre y deja de contar en `participantCount`, pero los votos que ya había emitido permanecen contabilizados hasta que se quite el producto.

---

## 4. Cómo funciona (y cómo evita condiciones de carrera)

Aunque Node.js ejecuta JavaScript en un solo hilo, las operaciones `async/await` se **intercalan** cuando esperan I/O de red:

```text
Tiempo ─────────────────────────────────────────────────────────────▶
Ana:  tryReserveProductId(5) -> true  ──[await DummyJSON 2s]──▶ commitProduct(5)
Juan:        tryReserveProductId(5) -> false (rechazado al instante como already_exists)
```

1. **Reserva síncrona antes del `await`:** como `tryReserveProductId(id)` es 100% síncrono, se ejecuta de principio a fin sin interrupciones en el Event Loop. Si el ID ya está en `products` o en `inFlightProductIds`, devuelve `false`.
2. **Confirmación o liberación:** cuando DummyJSON responde bien, `commitProduct()` mueve el ID de `inFlightProductIds` a `products`. Si DummyJSON falla o hace timeout, `releaseProductReservation()` libera el ID para que pueda volver a intentarse más adelante.
3. **Votos simultáneos:** cada `voteProduct(participantId, productId)` es síncrono y agrega el ID al `Set` de `voterIds`. Dos votos de usuarios distintos que lleguen casi a la vez se procesan en orden en el Event Loop y ambos quedan registrados; un segundo voto del mismo usuario es rechazado con `INVALID_VOTE_ACTION`.

---

## 5. Verificación realizada

- `npm run typecheck` → sin errores de tipos.
- `npm test` → **14/14 pruebas aprobadas** (5 pruebas de `store.test.ts` + 9 de `validation.test.ts`).
