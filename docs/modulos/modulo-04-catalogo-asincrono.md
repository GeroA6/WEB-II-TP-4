# Módulo 4 — Integración Asíncrona con DummyJSON (Concurrencia y Resiliencia)

## 1. Objetivo del módulo
Integrar el catálogo externo (DummyJSON) mediante operaciones asíncronas **en simultáneo** (sin bloquear el Event Loop ni al resto de los usuarios), con **tiempo máximo de espera configurable**, soporte para simular lentitud sin tocar el código y **tolerancia a fallos parciales**.

---

## 2. Qué hicimos

- `server/src/catalogClient.ts`:
  - Define la abstracción `CatalogClient` y el resultado discriminado `CatalogFetchResult` (`ok`, `not_found`, `timeout`, `catalog_error`).
  - Implementa `DummyJsonCatalogClient` usando `fetch` nativo de Node 22 + `AbortController` para cortar peticiones lentas al superar `CATALOG_TIMEOUT_MS`, anexando `?delay=<ms>` cuando `CATALOG_DELAY_MS > 0`.
  - Extrae y valida del lado del servidor `title`, `price` y `thumbnail` (con fallback a `images[0]`), garantizando que los datos de productos siempre provienen del servidor y nunca del cliente.
- `server/src/proposalService.ts`:
  - Implementa `ProposalService(store, catalogClient)`, que coordina propuestas de hasta 10 productos en tres fases: reserva síncrona, consultas concurrentes con `Promise.allSettled`, y confirmación/liberación en el store.
  - Devuelve `{ addedIds, failures }` con el motivo exacto de cada fallo (`already_exists`, `not_found`, `timeout`, `catalog_error`).
- `server/src/proposalService.test.ts`:
  - 4 pruebas automatizadas verificando ejecución paralela real, fallos parciales, dos propuestas simultáneas del mismo ID y el comportamiento HTTP completo de `DummyJsonCatalogClient` (200, 404, 500, timeout real con `AbortController` y parámetro `delay`).

---

## 3. Decisiones tomadas y principios SOLID aplicados

- **SRP (Responsabilidad Única):**
  - `DummyJsonCatalogClient` solo sabe hablar HTTP con el catálogo externo y mapear respuestas/errores.
  - `ProposalService` solo coordina el flujo de negocio (reservar → consultar en paralelo → confirmar o liberar).
- **DIP (Inversión de Dependencias) y LSP (Sustitución de Liskov):**
  - `ProposalService` depende de la interfaz `CatalogClient`, no de `fetch` ni de `DummyJsonCatalogClient`. Esto permite sustituir el cliente real por dobles de prueba en los tests sin depender de internet y probar timeouts y concurrencia de manera determinística.
- **`Promise.allSettled` en lugar de `Promise.all` o `for...await`:**
  - `for...await` consultaría secuencialmente (si 10 productos tardan 500 ms c/u, serían 5 s en vez de 500 ms).
  - `Promise.all` rechaza todo el lote apenas falla un solo producto, impidiendo agregar los válidos.
  - `Promise.allSettled` ejecuta todas las consultas **en simultáneo** y entrega el resultado individual de cada una, cumpliendo el requisito de tolerancia a fallos parciales.
- **Limpieza del timer en `finally`:**
  - Siempre llamamos a `clearTimeout(timer)` en `finally` para evitar mantener timers activos innecesariamente cuando el catálogo responde rápido.

---

## 4. Cómo funciona

Cuando un participante envía una propuesta (por ejemplo `[1, 2, 999, 1]`):

1. **Fase 1 — Reserva síncrona (`tryReserveProductId`):**
   - `1` se reserva.
   - `2` se reserva.
   - `999` se reserva.
   - El segundo `1` (o un ID que otro participante propuso milisegundos antes) falla la reserva al instante y entra en `failures` con `reason: "already_exists"`.
2. **Fase 2 — Consultas simultáneas (`Promise.allSettled`):**
   - Se disparan a la vez `fetchProduct(1)`, `fetchProduct(2)` y `fetchProduct(999)`.
   - Mientras el servidor espera esas respuestas HTTP, el Event Loop queda **totalmente libre** para atender votos, desconexiones u otras propuestas de los demás usuarios.
   - Cada `fetch` tiene su propio `AbortController` con `CATALOG_TIMEOUT_MS`.
3. **Fase 3 — Confirmación o liberación:**
   - Los exitosos se confirman en `GiftListStore` (`commitProduct`) y pasan a `addedIds`.
   - Los fallidos (`not_found`, `timeout`, `catalog_error`) liberan su reserva (`releaseProductReservation`) para poder reintentarse en el futuro y pasan a `failures`.
4. En el Módulo 5, `addedIds` provocará un *broadcast* a todos los clientes (solo si se agregó al menos un producto), mientras que `failures` se enviará **únicamente** a quien hizo la propuesta.

---

## 5. Verificación realizada

- `npm run typecheck` → sin errores de tipos.
- `npm test` → **18/18 pruebas aprobadas** (4 suites):
  - 3 productos con 60 ms de demora cada uno completaron en **68.4 ms** (demostrando ejecución paralela real).
  - Fallos parciales clasificados correctamente (`already_exists`, `timeout`, `not_found`, `catalog_error`) y reservas fallidas liberadas.
  - Dos propuestas simultáneas del mismo ID ejecutaron **una sola consulta** al catálogo y no generaron duplicados.
  - `DummyJsonCatalogClient` probado contra un servidor HTTP local temporal: 200 OK, 404, 500, timeout real con `AbortController` y query `?delay=123`.
