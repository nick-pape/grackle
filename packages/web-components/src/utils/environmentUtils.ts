/** Minimum valid network port. */
export const MIN_PORT: number = 1;
/** Maximum valid network port. */
export const MAX_PORT: number = 65535;

/** Returns true if portStr is empty (optional) or a valid integer in [1, 65535]. */
export function isPortValid(portStr: string): boolean {
  if (!portStr.trim()) {
    return true;
  }
  const n = Number(portStr);
  return Number.isInteger(n) && n >= MIN_PORT && n <= MAX_PORT;
}

/** Parse adapter config JSON string into a record, defaulting to empty object. */
export function parseAdapterConfig(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}
