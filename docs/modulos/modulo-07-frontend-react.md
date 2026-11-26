# Módulo 7 — Frontend en React + Vite (Participante y Pantalla)

## 1. Objetivo del módulo
Construir la interfaz de usuario mínima en **React + TypeScript + Vite** para los dos tipos de clientes (**Participante** en `/` usando `WebSocket` estándar y **Pantalla** en `/pantalla` usando `EventSource`), reutilizando el contrato compartido `shared/protocol.ts` y sirviendo todo desde **el mismo servidor Node.js en un único puerto**.

---

## 2. Qué hicimos

### Configuración y build unificado
- `vite.config.ts`, `client/tsconfig.json`, `client/index.html`: compilan el frontend React en `dist/client/` y proveen proxy en desarrollo para `/ws`, `/events` y `/health`.
- `package.json`: scripts `build:server`, `build:client`, `build` (compila ambos), `typecheck` (valida backend y frontend) y `dev:client`.

### Custom Hooks de comunicación (capa de red en React)
- `client/src/hooks/useParticipantSocket.ts`: encapsula la API nativa `WebSocket` hacia `/ws`, sincroniza `self`, `participants`, `products`, `lastProposalResult`, `isProposing` y `error`, y cierra el socket en el *cleanup* de `useEffect`.
- `client/src/hooks/useScreenEvents.ts`: encapsula la API nativa `EventSource` hacia `/events`, escucha el evento `state` con `{ products, participantCount }` y cierra la conexión al desmontar. Nunca envía datos al servidor.

### Componentes y vistas
- `client/src/components/JoinForm.tsx`: formulario de ingreso con nombre y visualización de errores del servidor (`INVALID_NAME`, `NAME_TAKEN`).
- `client/src/components/ProposalForm.tsx`: permite ingresar de 1 a 10 IDs separados por coma o espacio, muestra estado *"Consultando catálogo..."* y despliega los fallos parciales únicamente para quien propuso.
- `client/src/components/ProductCard.tsx`: componente reutilizable tanto en Participante como en Pantalla (`readOnly`), mostrando ranking, imagen, título, precio, autor, contador de votos, botones `Votar` / `Retirar voto` y botón `Quitar` visible solo para quien propuso el producto.
- `client/src/views/ParticipantView.tsx` (`/`) y `client/src/views/ScreenView.tsx` (`/pantalla`).
- `client/src/App.tsx`, `client/src/main.tsx`, `client/src/styles.css`.

### Servido de estáticos en el mismo servidor Node.js
- `server/src/staticFiles.ts`: `StaticFileServer` sirve los archivos compilados en `dist/client/`, protege contra *path traversal* (`..`) y resuelve las rutas SPA `/` y `/pantalla` hacia `index.html`.
- `server/src/app.ts`: conecta `StaticFileServer` en el mismo `httpServer` que ya atiende `/ws`, `/events` y `/health`.
- `server/src/staticFiles.test.ts`: prueba automatizada verificando `/` (200 HTML), `/pantalla` (200 HTML) y bloqueo de `/../package.json` (404).

---

## 3. Decisiones tomadas y principios SOLID aplicados

- **SRP (Responsabilidad Única) en React:**
  - Los hooks (`useParticipantSocket`, `useScreenEvents`) se ocupan exclusivamente de la comunicación en tiempo real y del estado derivado.
  - Los componentes (`JoinForm`, `ProposalForm`, `ProductCard`) solo reciben `props` y renderizan UI, sin conocer `WebSocket` ni `EventSource`.
- **SRP en el servidor:** `StaticFileServer` encapsula el servido de archivos estáticos y la protección de rutas, sin ensuciar `app.ts`.
- **Reutilización sin duplicación (`ProductCard` y `shared/protocol.ts`):**
  - El mismo componente `ProductCard` funciona en modo interactivo (Participante) y en modo `readOnly` (Pantalla).
  - Los tipos de mensajes se importan directamente de `shared/protocol.ts`, garantizando coherencia total entre servidor y navegador.
- **Sin dependencias innecesarias:** para solo dos rutas (`/` y `/pantalla`) no se agregó React Router; `App.tsx` lee `window.location.pathname`.

---

## 4. Cómo funciona

1. Al ejecutar `npm run build && npm start`:
   - `tsc` compila el servidor en `dist/server/`.
   - `vite build` genera el bundle de React en `dist/client/`.
   - `node --env-file-if-exists=.env dist/server/src/index.js` levanta **un único servidor en un único puerto** (por defecto `http://localhost:3000`).
2. Abrir `http://localhost:3000/` carga `ParticipantView`, que abre un `WebSocket` nativo a `ws://localhost:3000/ws`.
3. Abrir `http://localhost:3000/pantalla` carga `ScreenView`, que abre un `EventSource` nativo a `http://localhost:3000/events`.
4. Nota educativa de `React.StrictMode`: en modo desarrollo React monta, desmonta y vuelve a montar los efectos para detectar fugas de recursos. Como ambos hooks devuelven `() => ws.close()` y `() => source.close()`, las conexiones se limpian ordenadamente sin dejar sockets huérfanos.

---

## 5. Verificación realizada

- `npm run typecheck` → OK (backend + frontend React sin errores de tipos).
- `npm run build` → OK (`dist/server/` y `dist/client/` generados en < 1 s).
- `npm test` → **24/24 pruebas aprobadas** (7 suites, incluyendo `staticFiles.test.ts`).
