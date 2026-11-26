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
