import { createGiftListApp } from "./app.js";
import { loadConfig } from "./config.js";
import { getLanAddresses } from "./network.js";

const config = loadConfig();
const app = createGiftListApp(config);

app.httpServer.listen(config.port, config.host, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port} (bind: ${config.host})`);
  console.log(`  - Participante: http://localhost:${config.port}/`);
  console.log(`  - Pantalla SSE: http://localhost:${config.port}/pantalla`);
  console.log(`  - WebSocket:    ws://localhost:${config.port}/ws`);
  console.log(`  - SSE stream:   http://localhost:${config.port}/events`);

  if (config.host === "0.0.0.0" || config.host === "::") {
    const lanIps = getLanAddresses();
    if (lanIps.length > 0) {
      console.log("Acceso desde otros dispositivos en la misma red local (LAN):");
      for (const ip of lanIps) {
        console.log(`  - Participante: http://${ip}:${config.port}/`);
        console.log(`  - Pantalla SSE: http://${ip}:${config.port}/pantalla`);
      }
    }
  }

  console.log(
    `Catálogo: ${config.catalogUrl} | Timeout: ${config.catalogTimeoutMs}ms | Delay simulado: ${config.catalogDelayMs}ms`
  );
});
