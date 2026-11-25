import { createGiftListApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createGiftListApp(config);

app.httpServer.listen(config.port, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port}`);
  console.log(`WebSocket disponible en ws://localhost:${config.port}/ws`);
  console.log(
    `Catálogo: ${config.catalogUrl} | Timeout: ${config.catalogTimeoutMs}ms | Delay simulado: ${config.catalogDelayMs}ms`
  );
});
