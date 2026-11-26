# Módulo 8 — Documentación Final (`README.md`) y Evidencias

## 1. Objetivo del módulo
Consolidar toda la documentación técnica exigida por la consigna en el `README.md` raíz del repositorio y dejar preparada la guía paso a paso para reproducir los 7 escenarios de prueba y recolectar las evidencias visuales (video/GIF y capturas).

---

## 2. Qué hicimos

- `README.md`: documentación completa que cubre todos los apartados obligatorios de `MODEL/Contexto.md`:
  1. Instalación, compilación, ejecución, scripts y configuración por variables de entorno (`HOST`, `PORT`, `CATALOG_URL`, `CATALOG_TIMEOUT_MS`, `CATALOG_DELAY_MS`, `WS_HEARTBEAT_MS`), incluyendo comandos listos para simular un catálogo lento sin tocar el código.
  2. Contrato completo de mensajes WebSocket (Cliente → Servidor y Servidor → Participante) y evento SSE (`event: state`) con direcciones, campos, reglas de validación, alcances (*unicast* vs. *broadcast*) y ejemplos JSON.
  3. Justificación de las decisiones de diseño (nombres aceptados, prevención de duplicados concurrentes con reserva en vuelo, regla de eliminación por autor y timeout de `3000 ms`).
  4. Matriz de comportamiento ante lentitud, timeout y fallos parciales para cada tipo de usuario.
  5. Comparativa arquitectónica **WebSocket vs. SSE vs. Polling**.
  6. Resumen de los 5 opcionales implementados.
  7. Guía de prueba para los 7 escenarios (con snippet de consola para mensajes inválidos) y espacio para evidencias.
- `docs/roadmap.md`: actualización del checklist final marcando el Módulo 8 como completado.

---

## 3. Checklist de evidencias pendientes para la entrega

Para completar la entrega del TP4, solo resta grabar/capturar en tu máquina:
1. **Video corto o GIF** con al menos 3 participantes y la pantalla (`/pantalla`) sincronizados en vivo.
2. **Captura 1:** propuesta con fallos parciales (ej. `3, 99999, 1`) mostrando el aviso solo al autor y el válido en la lista.
3. **Captura 2:** comportamiento con el catálogo lento (`CATALOG_DELAY_MS=2500`) mientras otro usuario vota sin bloqueo.
4. **Captura 3:** respuesta `error` del servidor a un mensaje inválido enviado desde la consola del navegador.
