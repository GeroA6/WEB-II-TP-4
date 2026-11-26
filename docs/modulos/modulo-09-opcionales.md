# Módulo 9 (Opcionales) — Mejoras Extra

Este documento registra cada funcionalidad opcional implementada sobre la base obligatoria del TP4.

---

## Opcional 1: Pruebas automatizadas con `node:test`
Ya cubierto de forma transversal desde el Módulo 2 (validación de mensajes en `server/src/validation.test.ts` y pruebas de dominio, catálogo, WebSocket, SSE, estáticos y red local).

---

## Opcional 2: Conexión desde otro dispositivo de la misma red (LAN)

### Qué hicimos
- `server/src/config.ts` y `.env.example`: agregamos la variable de entorno `HOST` (default `"0.0.0.0"`) para escuchar en todas las interfaces de red del equipo, manteniendo la opción de restringir a `127.0.0.1` si se desea.
- `server/src/network.ts`: utilidad `getLanAddresses()` (SRP + DIP) que inspecciona `os.networkInterfaces()` y filtra únicamente direcciones IPv4 externas (descartando `127.0.0.1` e IPv6).
- `server/src/index.ts` y `server/src/app.ts`: el servidor hace `listen(config.port, config.host)`, expone `host` en `/health` e imprime automáticamente las URLs de red local (`http://<IP-LAN>:<PORT>/` y `/pantalla`) al arrancar.
- `server/src/network.test.ts`: 2 pruebas unitarias verificando el valor por defecto/override de `HOST` y el filtrado de interfaces IPv4 externas.

### Por qué funciona sin cambios en el frontend
- Tanto `useParticipantSocket` (`${protocol}//${window.location.host}/ws`) como `useScreenEvents` (`new EventSource("/events")`) usan direcciones **relativas al host actual**, nunca `localhost` hardcodeado. Por eso un celular o notebook en la misma red Wi-Fi puede abrir `http://<IP-LAN>:3000/` o `/pantalla` y conectarse al instante.

### Verificación
- `npm run typecheck` → OK.
- `npm run build:server` → OK.
- `npm test` → **26/26 pruebas aprobadas** (8 suites).

---

## Opcional 3: Reconexión automática del participante

### Qué hicimos
- `shared/protocol.ts`, `server/src/validation.ts` y `server/src/wsGateway.ts`:
  - Agregamos el campo opcional `participantId?: string` en `JoinMessage` (retrocompatible con clientes que solo envían `name`).
  - Cuando un participante se reconecta mientras el servidor sigue activo enviando su `participantId` previo (y esa sesión ya se había desconectado), el servidor reutiliza ese mismo identificador: así conserva sus **votos previos** (no puede votar doble y puede retirar votos anteriores) y su **permiso de autor** para quitar los productos que propuso.
- `client/src/hooks/useParticipantSocket.ts`:
  - Agregamos el estado `"reconnecting"` y reconexión automática con *exponential backoff* (`1s → 2s → 4s → máximo 5s`), reseteando el contador al reconectar y cancelando timers al desmontar el componente (`isUnmountedRef`).
  - Persistimos `{ id, name }` de la sesión en `sessionStorage` (aislado por pestaña): cuando el nuevo `WebSocket` se abre, reenvía automáticamente `{ type: "join", name, participantId }`, recibiendo `welcome` con el estado actualizado de participantes y productos.
  - Si mientras estuvo desconectado otro participante tomó su nombre (`NAME_TAKEN`), se limpia la sesión guardada y se muestra `JoinForm` con el aviso claro.
- `client/src/views/ParticipantView.tsx`, `client/src/components/ProductCard.tsx` y `client/src/styles.css`:
  - Muestran el estado `"Reconectando..."`, un aviso visual mientras se restablece el enlace y deshabilitan los botones de acción hasta volver a estar `"open"`.
- `server/src/wsGateway.test.ts`:
  - Nueva prueba de integración verificando reconexión con conservación de `participantId`, prevención de doble voto y permiso de autor para quitar productos.

### Verificación
- `npm run typecheck` → OK (backend + React).
- `npm run build` → OK (`dist/server/` y `dist/client/` actualizados).
- `npm test` → **27/27 pruebas aprobadas** (8 suites).

---

## Opcional 4: Detección de conexiones muertas con `ping` y `pong`

### Qué hicimos
- `server/src/config.ts` y `.env.example`: agregamos la variable `WS_HEARTBEAT_MS` (default `15000` ms, `0` para desactivar).
- `server/src/wsGateway.ts`:
  - Mantenemos el estado vivo de cada socket en un `WeakMap<WebSocket, boolean>` (`aliveState`) para no retener memoria cuando un socket se libera.
  - En cada ciclo de `setInterval`, si `isAlive === false` (no respondió al `ping` anterior) ejecutamos `ws.terminate()`, lo que dispara `close` y limpia al participante en el store y en la pantalla SSE. Si estaba vivo, lo marcamos `false` y enviamos `ws.ping()`.
  - El listener `ws.on("pong")` vuelve a marcar `isAlive = true`. Todos los navegadores estándar responden `pong` automáticamente a nivel de protocolo RFC 6455 sin cambios en React.
  - En `WsGateway.close()` limpiamos el intervalo (`clearInterval`).
- `server/src/wsGateway.test.ts`: nueva prueba de integración con `wsHeartbeatMs: 50` donde un cliente con `autoPong: false` es detectado como muerto, terminado automáticamente y eliminado de `participants_updated` de los demás usuarios.

### Verificación
- `npm run typecheck` → OK.
- `npm run build:server` → OK.
- `npm test` → **28/28 pruebas aprobadas** (8 suites).

---

## Opcional 5: Varias listas independientes con código para unirse

### Qué hicimos
- `server/src/roomManager.ts`:
  - Implementa `RoomManager` (SRP + OCP + ISP) que crea y administra salas independientes por código (`Map<roomCode, RoomContext>`), reutilizando `GiftListStore` y `ProposalService` sin modificarlos.
  - Expone `normalizeRoomCode()` (2 a 20 caracteres alfanuméricos o guiones en mayúsculas, con `"GENERAL"` por defecto para mantener 100% retrocompatibilidad) y la interfaz de solo lectura `ReadOnlyRoomProvider` para `SseBroker`.
- `server/src/wsGateway.ts`, `server/src/sseBroker.ts`, `server/src/app.ts` y `shared/protocol.ts`:
  - Tanto `/ws?room=<CODIGO>` como `/events?room=<CODIGO>` operan por sala: participantes, nombres únicos, productos, votos y eventos SSE están completamente aislados entre listas.
  - `WelcomeMessage` y `ScreenStateEvent` incluyen `roomCode`.
- `client/src/`:
  - `JoinForm` permite ingresar un código de lista existente o generar uno aleatorio (`GIFT-XXXX`).
  - `ParticipantView` muestra el código activo, un botón **"Copiar link de lista"** (`/?room=<CODIGO>`) y el enlace **"Abrir Pantalla (SSE)"** apuntando directo a `/pantalla?room=<CODIGO>`.
  - `useParticipantSocket` persiste `{ id, name, roomCode }` en `sessionStorage` para que la reconexión automática vuelva a la misma lista.
- `server/src/roomManager.test.ts`: 2 pruebas verificando normalización de códigos y aislamiento total (WS + SSE) entre `SALA-A` y `SALA-B`.

### Verificación
- `npm run typecheck` → OK (backend + React).
- `npm run build` → OK (`dist/server/` y `dist/client/` actualizados).
- `npm test` → **30/30 pruebas aprobadas** (9 suites).
