export interface AppConfig {
  host: string;
  port: number;
  catalogUrl: string;
  catalogTimeoutMs: number;
  catalogDelayMs: number;
  wsHeartbeatMs: number;
}

export const DOMAIN_RULES = {
  participantNameMinLength: 2,
  participantNameMaxLength: 20,
  maxProductsPerProposal: 10,
} as const;

const DEFAULTS = {
  host: "0.0.0.0",
  port: 3000,
  catalogUrl: "https://dummyjson.com/products",
  catalogTimeoutMs: 3000,
  catalogDelayMs: 0,
  wsHeartbeatMs: 15000,
} as const;

function parseIntegerEnv(
  raw: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max?: number
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    const range = max !== undefined ? `entre ${min} y ${max}` : `mayor o igual a ${min}`;
    throw new Error(`Variable de entorno inválida ${name}="${raw}": debe ser un entero ${range}.`);
  }

  return parsed;
}

function parseUrlEnv(raw: string | undefined, fallback: string, name: string): string {
  const value = raw?.trim() || fallback;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("protocolo no soportado");
    }
    return value.replace(/\/+$/, "");
  } catch {
    throw new Error(`Variable de entorno inválida ${name}="${value}": debe ser una URL http(s) válida.`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.HOST?.trim() || DEFAULTS.host;
  return {
    host,
    port: parseIntegerEnv(env.PORT, DEFAULTS.port, "PORT", 1, 65535),
    catalogUrl: parseUrlEnv(env.CATALOG_URL, DEFAULTS.catalogUrl, "CATALOG_URL"),
    catalogTimeoutMs: parseIntegerEnv(
      env.CATALOG_TIMEOUT_MS,
      DEFAULTS.catalogTimeoutMs,
      "CATALOG_TIMEOUT_MS",
      100
    ),
    catalogDelayMs: parseIntegerEnv(
      env.CATALOG_DELAY_MS,
      DEFAULTS.catalogDelayMs,
      "CATALOG_DELAY_MS",
      0
    ),
    wsHeartbeatMs: parseIntegerEnv(
      env.WS_HEARTBEAT_MS,
      DEFAULTS.wsHeartbeatMs,
      "WS_HEARTBEAT_MS",
      0
    ),
  };
}
