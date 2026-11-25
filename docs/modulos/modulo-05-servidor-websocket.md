# Módulo 5 — Servidor HTTP + WebSocket para Participantes

## 1. Objetivo del módulo
Integrar el servidor **WebSocket estándar** (`ws`, sin protocolos propietarios como Socket.IO) sobre el **mismo servidor HTTP y único puerto**, conectando la validación defensiva (Módulo 2), el estado en memoria (Módulo 3) y el servicio asíncrono de propuestas (Módulo 4) con sincronización en tiempo real entre múltiples participantes.

---

## 2. Qué hicimos

- `server/src/wsGateway.ts`:
  - Implementa `WsGateway`, que monta `WebSocketServer({ server: httpServer, path: "/ws" })` sobre el servidor HTTP existente.
  - Asigna un `connectionId` único (`crypto.randomUUID()`) a cada conexión WebSocket y mantiene en `joinedSockets` solo las sesiones que ya ingresaron con nombre.
  - Maneja todos los mensajes validados (`join`, `propose_products`, `vote`, `unvote`, `remove_product`), diferenciando **unicast** (solo al emisor) de **broadcast** (a todos los conectados con `readyState === WebSocket.OPEN`).
  - Limpia la sesión y notifica al resto cuando un participante cierra la pestaña (`close`) o falla la conexión (`error`).
  - Expone el callback opcional `onStateChange` para notificar a observadores externos (como el módulo SSE en la siguiente fase).
- `server/src/app.ts` y `server/src/index.ts`:
  - `createGiftListApp(config, overrides?)` compone `GiftListStore`, `DummyJsonCatalogClient`, `ProposalService`, `httpServer` y `WsGateway`.
  - `index.ts` queda como punto de entrada mínimo encargado únicamente de cargar configuración y llamar a `listen()`.
- `server/src/wsGateway.test.ts`:
  - 3 pruebas de integración reales con múltiples clientes `WebSocket` conectados por red local (`127.0.0.1` en puerto efímero).

---

## 3. Decisiones tomadas y principios SOLID aplicados

- **SRP (Responsabilidad Única):**
  - `wsGateway.ts` solo sabe traducir frames WebSocket hacia y desde las capas internas; no contiene reglas de validación (`validation.ts`), ni reglas de dominio (`store.ts`), ni lógica de `fetch` (`catalogClient.ts`).
  - Separar `app.ts` de `index.ts` permite instanciar la aplicación completa en tests sin ejecutar `listen()` automáticamente al importar el archivo.
- **OCP (Abierto/Cerrado):**
  - `WsGateway` acepta `onStateChange?: () => void`. En el Módulo 6 vamos a suscribir el broker de **Server-Sent Events** a ese hook sin tener que modificar el código interno de `WsGateway`.
- **DIP (Inversión de Dependencias):**
  - `createGiftListApp` permite inyectar un `CatalogClient` alternativo (`overrides.catalogClient`), lo que hace posible correr pruebas de integración WebSocket completas sin depender de internet ni de latencias externas.
- **Aislamiento de conexiones no unidas (`joinedSockets`):**
  - Una pestaña que abrió el socket pero todavía no envió `join` no recibe *broadcasts* ni cuenta como participante hasta completar el ingreso.
- **Aislamiento de errores:**
  - Los errores de validación (`error`) y los fallos parciales de propuestas (`proposal_result`) viajan **exclusivamente** al socket que originó la acción.

---

## 4. Cómo funciona

1. **Un único puerto (HTTP + WS):** cuando el navegador abre `ws://localhost:3000/ws`, envía una petición HTTP normal con cabecera `Upgrade: websocket`. El `WebSocketServer` de `ws` intercepta ese evento `upgrade` en el mismo `httpServer` que atiende `/health` (y luego SSE y React).
2. **Flujo de ingreso (`join`):**
   - El servidor valida el nombre, registra la sesión en `GiftListStore`, envía `welcome` (unicast) con `self`, `participants` y `products` al recién llegado, y envía `participants_updated` (broadcast) al resto.
3. **Flujo sin bloqueos (`propose_products`):**
   - `handleMessage` dispara `void this.handleProposal(...)` y retorna inmediatamente al Event Loop.
   - Mientras DummyJSON tarda en responder, otros clientes pueden enviar `vote`, `unvote`, `join` o `close` y recibir respuestas instantáneas.
   - Cuando `ProposalService` termina, si hubo productos agregados se hace broadcast de `products_updated`, y siempre se envía `proposal_result` solo al autor.
4. **Limpieza al cerrar pestaña (`close`):**
   - Se elimina el socket de `joinedSockets`, se invoca `store.leaveParticipant(connectionId)` (liberando su nombre) y se envía `participants_updated` a los demás.

---

## 5. Verificación realizada

- `npm run typecheck` → sin errores de tipos.
- `npm test` → **21/21 pruebas aprobadas** (5 suites), incluyendo 3 pruebas de integración WebSocket:
  1. Entrada tardía recibe estado completo (`welcome`), fallo parcial informa solo al autor y cierre de pestaña actualiza participantes.
  2. Con catálogo lento (160 ms), el voto de otro participante se procesa y propaga de inmediato (< 100 ms) sin esperar a la propuesta lenta.
  3. Mensajes inválidos (JSON roto y tipo desconocido) devuelven `error` solo al emisor y el servidor continúa operando con normalidad.
