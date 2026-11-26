import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";
import { getLanAddresses } from "./network.js";

describe("Red local (LAN) y configuración HOST", () => {
  it("usa 0.0.0.0 por defecto para aceptar conexiones LAN y permite sobrescribir HOST", () => {
    const defaultCfg = loadConfig({});
    assert.equal(defaultCfg.host, "0.0.0.0");

    const customCfg = loadConfig({ HOST: "127.0.0.1" });
    assert.equal(customCfg.host, "127.0.0.1");
  });

  it("filtra únicamente direcciones IPv4 externas (no loopback ni IPv6)", () => {
    const ips = getLanAddresses({
      Loopback: [
        {
          address: "127.0.0.1",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          internal: true,
          cidr: "127.0.0.1/8",
        },
      ],
      WiFi: [
        {
          address: "fe80::1",
          netmask: "ffff:ffff:ffff:ffff::",
          family: "IPv6",
          mac: "aa:bb:cc:dd:ee:ff",
          internal: false,
          cidr: "fe80::1/64",
          scopeid: 1,
        },
        {
          address: "192.168.1.42",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "aa:bb:cc:dd:ee:ff",
          internal: false,
          cidr: "192.168.1.42/24",
        },
      ],
    });

    assert.deepEqual(ips, ["192.168.1.42"]);
  });
});
