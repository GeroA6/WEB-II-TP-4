# Módulo 6 — Server-Sent Events (SSE) para la Pantalla

## 1. Objetivo del módulo
Implementar la comunicación en tiempo real **unidireccional** (Servidor → Pantalla) mediante **Server-Sent Events (`GET /events`)** sobre el **mismo servidor HTTP y único puerto**, manteniendo sincronizados el ranking de productos y la cantidad de participantes conectados sin recargar la página y liberando recursos al cerrarse la pestaña.

---

## 2. Qué hicimos

- `server/src/sseBroker.ts`:
  - Implementa `SseBroker(readOnlyList)`, que gestiona el endpoint `GET /events` con cabeceras `text/event-stream`, `Cache-Control: no-cache, no-transform` y `Connection: keep-alive`.
  - Envía el estado inicial completo (`event: state`) apenas se conecta una pantalla.
  - Emite actualizaciones en vivo (`broadcastState()`) a todas las pantallas conectadas con formato SSE estándar (`event: state\ndata: {...}\n\n`).
  - Limpia automáticamente la conexión del `Set` cuando la pantalla se cierra (`req.on("close")` / `res.on("close")`).
- `server/src/app.ts` e `index.ts`:
  - Expone `GET /events` en el mismo servidor HTTP y agrega `sseClients` a las métricas de `/health`.
  - Conecta `WsGateway.onStateChange` con `sseBroker.broadcastState()` para que cualquier ingreso, salida, propuesta, voto o eliminación se refleje instantáneamente en la pantalla.
- `server/src/sseBroker.test.ts`:
  - 2 pruebas de integración reales combinando clientes `WebSocket` + stream HTTP `GET /events`.

---

## 3. Decisiones tomadas y principios SOLID aplicados

- **ISP (Segregación de Interfaces) y DIP (Inversión de Dependencias):**
  - `SseBroker` depende únicamente de `ReadOnlyGiftList` (definida en el Módulo 3). Desde el diseño de tipos es imposible que la capa de la pantalla modifique productos o participantes.
- **OCP (Abierto/Cerrado):**
  - Para integrar SSE no fue necesario modificar **ni una sola línea** de `wsGateway.ts`: bastó suscribir `sseBroker.broadcastState()` al hook `onStateChange` en `app.ts`.
- **SRP (Responsabilidad Única):**
  - `sseBroker.ts` se ocupa únicamente de abrir streams `text/event-stream`, formatear los eventos SSE y limpiar clientes cerrados.
- **Por qué SSE para la pantalla, WebSocket para participantes y no Polling:**
  - **Participantes → WebSocket:** necesitan comunicación **bidireccional** frecuente (enviar propuestas, votos y eliminaciones, y recibir cambios en vivo).
  - **Pantalla → SSE (`EventSource`):** solo **recibe** actualizaciones (unidireccional). SSE usa HTTP estándar, tiene menor complejidad que WebSocket y ofrece reconexión automática nativa en el navegador.
  - **¿Qué cambiaría con Polling?** Si la pantalla consultara `GET /state` cada N segundos, habría **latencia artificial** (desfase entre voto y pantalla), **peticiones innecesarias** cuando nadie interactúa (desperdicio de red y CPU) y un compromiso constante entre frescura de datos y carga del servidor.

---

## 4. Cómo funciona

1. La pantalla abre `new EventSource("/events")` (petición HTTP `GET /events`).
2. `SseBroker.handleRequest` responde `200 OK` con `Content-Type: text/event-stream; charset=utf-8` y llama a `res.flushHeaders()` sin cerrar la respuesta (`res.end()` no se invoca).
3. Inmediatamente escribe el primer evento con el estado actual:
   ```text
   event: state
   data: {"products":[...],"participantCount":2}

   ```
4. Cada vez que un participante realiza una acción por WebSocket que modifica el estado (`join`, `leave`, `propose_products` con altas, `vote`, `unvote`, `remove_product`), `WsGateway` dispara `onStateChange()`, que invoca `sseBroker.broadcastState()`.
5. Al cerrarse la pestaña de la pantalla, Node dispara el evento `close` en `req`/`res`, eliminando esa respuesta del `Set` de suscriptores para evitar escrituras a streams cerrados y fugas de memoria.

---

## 5. Verificación realizada

- `npm run typecheck` → sin errores de tipos.
- `npm test` → **23/23 pruebas aprobadas** (6 suites), incluyendo las 2 pruebas de integración de `sseBroker.test.ts`:
  1. La pantalla recibe el estado inicial inmediato y refleja en tiempo real el ingreso de un participante, la propuesta de un producto, su voto y la desconexión del participante.
  2. Al cerrar el cliente SSE, `sseBroker.getClientCount()` vuelve inmediatamente a `0`.
