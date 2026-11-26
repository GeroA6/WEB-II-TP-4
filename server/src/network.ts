import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

/**
 * Extrae las direcciones IPv4 externas (LAN) disponibles en el equipo (SRP).
 * Acepta el mapa de interfaces por parámetro para facilitar pruebas unitarias (DIP).
 */
export function getLanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()
): string[] {
  const addresses: string[] = [];

  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family === "IPv4" && !info.internal) {
        addresses.push(info.address);
      }
    }
  }

  return addresses;
}
