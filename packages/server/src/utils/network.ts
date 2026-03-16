import { networkInterfaces } from "node:os";

/**
 * Detect the first non-internal IPv4 address on the machine (LAN IP).
 *
 * Returns `undefined` when no suitable interface is found.
 */
export function detectLanIp(): string | undefined {
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) {
      continue;
    }
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return undefined;
}
