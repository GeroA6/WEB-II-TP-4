# Módulo 1 — Arquitectura, Decisiones de Diseño y Entorno

## 1. Objetivo del módulo
Establecer las reglas de negocio iniciales del TP4, configurar un entorno limpio de **Node.js (LTS) + TypeScript** en modo estricto y levantar un servidor HTTP mínimo capaz de leer su configuración desde variables de entorno sin modificar el código.

---

## 2. Qué hicimos

Creamos la base del proyecto con los siguientes archivos:

- `package.json`: define el proyecto como ES Modules (`"type": "module"`), declara la dependencia `ws` (para el Módulo 5) y las herramientas de desarrollo (`typescript`, `tsx`, `@types/node`, `@types/ws`), y provee los scripts:
  - `npm run dev`: ejecuta el servidor en caliente con `tsx watch`.
  - `npm run typecheck`: valida tipos sin emitir archivos (`tsc --noEmit`).
  - `npm run build`: compila TypeScript a `dist/`.
  - `npm start`: ejecuta el build compilado en Node.js.
- `tsconfig.json`: configura TypeScript moderno (`target: "ES2022"`, `module: "NodeNext"`, `strict: true`, `noUncheckedIndexedAccess: true`) abarcando `server/src/` y `shared/`.
- `.gitignore`: excluye `node_modules/`, `dist/`, `.env` y archivos de log.
- `.env.example`: plantilla documentada con las variables de entorno soportadas.
- `server/src/config.ts`: carga y valida las variables de entorno (`PORT`, `CATALOG_URL`, `CATALOG_TIMEOUT_MS`, `CATALOG_DELAY_MS`) y centraliza las constantes de reglas de dominio (`DOMAIN_RULES`).
- `server/src/index.ts`: servidor HTTP mínimo usando el módulo nativo `node:http` con un endpoint de diagnóstico `GET /health`.

---

## 3. Decisiones tomadas y por qué

### A. Reglas de negocio (requeridas por la consigna)
1. **Nombres de participantes:** no vacíos, sin espacios sobrantes (`trim`), longitud entre **2 y 20 caracteres**, y **sin nombres repetidos entre participantes actualmente conectados** (comparación insensible a mayúsculas, ej. `"Ana"` y `"ana"` se consideran iguales).
   - *Por qué:* evita nombres vacíos o excesivamente largos que rompan la interfaz y evita confusión en la lista de conectados y votos. Al comparar solo contra conectados, si alguien se va y vuelve a entrar con su nombre, puede hacerlo.
2. **Quién puede quitar un producto:** **solo el participante que lo propuso** (mientras mantenga su sesión conectada).
   - *Por qué:* evita que otros borren propuestas ajenas por error o conflicto, manteniendo una regla clara y verificable en el servidor mediante el identificador de sesión del autor.
3. **Timeout por defecto del catálogo (`CATALOG_TIMEOUT_MS`):** **3000 ms (3 segundos)**, siempre sobreescribible por variable de entorno.
   - *Por qué:* es lo bastante holgado para respuestas normales de DummyJSON (~200–800 ms), pero lo bastante corto para no dejar esperando innecesariamente al usuario ante una caída o lentitud extrema, y facilita probar timeouts con `CATALOG_DELAY_MS=4000` o `5000`.

### B. Decisiones técnicas del entorno
- **Node.js `node:http` + `ws` + React/Vite (en lugar de T3 Stack / Next.js):** permite controlar directamente el servidor HTTP único que servirá páginas estáticas, WebSockets nativos y Server-Sent Events en un mismo puerto, haciendo visibles los mecanismos de Node.js que evalúa el TP.
- **Validación *fail-fast* de variables de entorno:** si alguien arranca el servidor con `PORT=abc` o `CATALOG_TIMEOUT_MS=-5`, `loadConfig()` lanza un error claro al instante en lugar de fallar más adelante con un comportamiento extraño.
- **`--env-file-if-exists=.env` nativo de Node 22:** permite cargar `.env` opcionalmente sin instalar paquetes extra, y al mismo tiempo sobrescribir variables directamente desde la terminal.

---

## 4. Cómo funciona

1. Al ejecutar `server/src/index.ts`, primero se llama a `loadConfig()`, que inspecciona `process.env`, aplica valores por defecto si falta alguna variable y valida tipos y rangos (puertos entre `1` y `65535`, URL `http/https`, enteros no negativos).
2. Luego `createAppServer(config)` crea un servidor con `node:http`. Cada request entrante se parsea con la clase estándar `URL`.
3. Si llega `GET /health`, responde `200 OK` con un JSON que informa el estado y la configuración activa (`port`, `catalogUrl`, `catalogTimeoutMs`, `catalogDelayMs`). Cualquier otra ruta devuelve `404` en formato JSON.
4. En módulos posteriores, **este mismo servidor HTTP** va a manejar también el *upgrade* a WebSocket (Módulo 5), el stream de Server-Sent Events (Módulo 6) y los archivos estáticos de React (Módulo 7), cumpliendo la regla de un único puerto.

---

## 5. Verificación realizada

Se ejecutaron y comprobaron los siguientes pasos:
1. `npm run typecheck` → pasó sin errores.
2. `npm run build` → compiló correctamente en `dist/`.
3. Ejecución del servidor con variables de entorno personalizadas (`PORT=3123` y `CATALOG_DELAY_MS=1500`) y consulta a `GET http://localhost:3123/health`:
   ```json
   {
     "status": "ok",
     "config": {
       "port": 3123,
       "catalogUrl": "https://dummyjson.com/products",
       "catalogTimeoutMs": 3000,
       "catalogDelayMs": 1500
     }
   }
   ```
