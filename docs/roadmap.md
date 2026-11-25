# Roadmap Educativo — TP4: Asincronismo e Integración con Node.js y TypeScript

> **Objetivo principal:** Aprender los fundamentos de Node.js, asincronismo, comunicación en tiempo real (WebSocket y SSE), diseño de contratos tipados y tolerancia a fallos, construyendo paso a paso una lista compartida en tiempo real con catálogo externo (DummyJSON).

## Stack Tecnológico Acordado

- **Backend:** Node.js (LTS) + TypeScript (`tsx` / `tsc`), módulo nativo `node:http` y librería `ws` (WebSocket estándar RFC 6455, sin protocolos propietarios).
- **Frontend:** React + TypeScript con Vite, compilado a archivos estáticos servidos por **el mismo servidor Node.js en un único puerto**.
- **Persistencia:** En memoria del servidor (sin base de datos).
- **Catálogo externo:** DummyJSON (con timeout configurable y soporte para `delay` vía variables de entorno).
- **Documentación por fase:** Al finalizar cada módulo se crea su documento en `docs/modulos/` explicando *qué hicimos*, *por qué* y *cómo funciona*.

---

## Progreso General

- [x] **Módulo 1:** Arquitectura, Decisiones de Diseño y Entorno (`docs/modulos/modulo-01-arquitectura-y-entorno.md`)
- [x] **Módulo 2:** Contrato de Mensajes y Validación en TypeScript (`docs/modulos/modulo-02-contrato-y-validacion.md`)
- [x] **Módulo 3:** Estado en Memoria y Reglas de Negocio (`docs/modulos/modulo-03-estado-y-reglas.md`)
- [ ] **Módulo 4:** Integración Asíncrona con DummyJSON (`docs/modulos/modulo-04-catalogo-asincrono.md`)
- [ ] **Módulo 5:** Servidor HTTP + WebSocket para Participantes (`docs/modulos/modulo-05-servidor-websocket.md`)
- [ ] **Módulo 6:** Server-Sent Events (SSE) para la Pantalla (`docs/modulos/modulo-06-sse-pantalla.md`)
- [ ] **Módulo 7:** Frontend en React + Vite (Participante y Pantalla) (`docs/modulos/modulo-07-frontend-react.md`)
- [ ] **Módulo 8:** Documentación Final (`README.md`) y Evidencias (`docs/modulos/modulo-08-readme-y-evidencias.md`)
- [ ] **Módulo 9 (Opcional):** Mejoras extra

---

## Detalle de Módulos

### Módulo 1: Arquitectura, Decisiones de Diseño y Entorno
- **Qué vas a aprender:** Estructura de un proyecto Node.js + TypeScript, configuración mediante variables de entorno y definición de reglas de negocio antes de programar.
- **Qué vamos a hacer:**
  - Definir las decisiones obligatorias: reglas de nombres de usuario, regla para quitar productos y tiempo máximo de espera (timeout) del catálogo con su justificación.
  - Configurar `package.json`, `tsconfig.json`, estructura de carpetas (`server/`, `shared/`, `client/`) y lectura de variables de entorno (`PORT`, `CATALOG_URL`, `CATALOG_TIMEOUT_MS`, `CATALOG_DELAY_MS`).
  - Levantar un servidor HTTP mínimo en TypeScript.
- **Verificación:** El servidor inicia en el puerto configurado, lee las variables de entorno y responde a una ruta básica de salud (`/health`).

### Módulo 2: Contrato de Mensajes y Validación (TypeScript)
- **Qué vas a aprender:** Diseño de protocolos JSON, *discriminated unions* en TypeScript y validación defensiva en el servidor (*"el servidor decide"*).
- **Qué vamos a hacer:**
  - Definir en `shared/` los tipos de mensajes Cliente → Servidor, Servidor → Participante y Eventos SSE → Pantalla.
  - Implementar validadores estrictos (JSON inválido, `type` desconocido, campos faltantes, rangos inválidos como 0 o más de 10 IDs) que devuelvan errores estructurados sin hacer caer el servidor.
- **Verificación:** Comprobar que los mensajes válidos pasan tipados y los inválidos producen errores claros y seguros.

### Módulo 3: Estado en Memoria y Reglas de Negocio
- **Qué vas a aprender:** Modelado de estado en memoria, encapsulación de lógica de dominio y prevención de condiciones de carrera (*race conditions*).
- **Qué vamos a hacer:**
  - Implementar el estado en memoria de participantes conectados y lista de productos.
  - Implementar alta/baja de participantes, registro de productos, votación (1 voto por persona, retirar voto, ordenamiento por votos) y eliminación según la regla definida.
  - Controlar consistencia ante acciones simultáneas (por ejemplo, reservar IDs "en vuelo" para evitar duplicados cuando dos usuarios proponen el mismo producto a la vez).
- **Verificación:** Verificar todas las reglas de negocio y casos borde de forma aislada.

### Módulo 4: Integración Asíncrona con DummyJSON (Concurrencia y Resiliencia)
- **Qué vas a aprender:** Event Loop sin bloqueos, consultas concurrentes con `Promise.allSettled`, timeouts con `AbortController` y tolerancia a fallos parciales.
- **Qué vamos a hacer:**
  - Crear el cliente del catálogo que consulte hasta 10 productos en simultáneo.
  - Aplicar el timeout configurable y soportar el parámetro `delay` por variable de entorno para simular lentitud sin tocar el código.
  - Clasificar cada fallo: producto inexistente, catálogo sin respuesta a tiempo (timeout) y producto ya existente en la lista.
- **Verificación:** Probar propuestas mixtas (válidos + inexistentes + duplicados) y simular respuestas lentas por debajo y por encima del timeout.

### Módulo 5: Servidor HTTP + WebSocket para Participantes
- **Qué vas a aprender:** Compartir un único puerto entre HTTP y WebSocket (`ws`), ciclo de vida de conexiones, *broadcast* vs *unicast* (errores privados al emisor) y liberación de recursos al desconectar.
- **Qué vamos a hacer:**
  - Conectar el servidor WebSocket sobre el mismo servidor `node:http`.
  - Enviar el estado inicial completo al entrar y sincronizar altas, bajas, propuestas, votos y eliminaciones.
  - Garantizar que las esperas al catálogo no bloqueen a otros clientes y que al cerrar una pestaña se limpie la conexión y se actualice la lista de participantes.
- **Verificación:** Probar múltiples clientes simultáneos, desconexiones abruptas y envío de mensajes inválidos desde la consola del navegador.

### Módulo 6: Server-Sent Events (SSE) para la Pantalla
- **Qué vas a aprender:** Diferencias prácticas entre WebSocket, SSE y Polling; streams HTTP unidireccionales (`text/event-stream`) y limpieza de conexiones cerradas.
- **Qué vamos a hacer:**
  - Crear el endpoint SSE en el mismo servidor y puerto.
  - Enviar el estado inicial (ranking + cantidad de conectados) al conectar y emitir eventos en vivo ante cada cambio relevante.
  - Liberar el cliente SSE al cerrar la pestaña.
- **Verificación:** Conectar un cliente SSE y verificar actualizaciones en vivo sin recargar.

### Módulo 7: Frontend en React + Vite (Participante y Pantalla)
- **Qué vas a aprender:** Integración de APIs nativas (`WebSocket` y `EventSource`) dentro de componentes React (`useState`, `useEffect` y *cleanup*), reutilización del contrato TypeScript y servido de estáticos desde Node.js.
- **Qué vamos a hacer:**
  - Crear el proyecto React + Vite en `client/` con dos vistas/rutas simples: **Participante** (`/`) y **Pantalla** (`/pantalla`).
  - Configurar el servidor `node:http` para servir el build de React desde el mismo puerto.
- **Verificación:** Ejecutar los 7 casos de prueba de la sección *"Cómo la vamos a probar"* de `MODEL/Contexto.md` con 3 participantes y 1 pantalla.

### Módulo 8: Documentación Final (`README.md`) y Evidencias
- **Qué vas a aprender:** Documentación técnica de contratos de comunicación y justificación de decisiones de arquitectura.
- **Qué vamos a hacer:**
  - Completar `README.md` con: instalación/ejecución, contrato de mensajes y eventos, decisiones de diseño justificadas, qué ve cada usuario ante fallos/demoras y comparativa WebSocket vs SSE vs Polling.
  - Preparar el checklist para grabar el video/GIF y sacar las capturas exigidas.

### Módulo 9 (Opcional): Mejoras Extra
- A elegir al completar lo obligatorio: reconexión automática, ping/pong para conexiones muertas, pruebas automatizadas con `node:test`, varias listas con código o conexión desde otro dispositivo en la red local.
