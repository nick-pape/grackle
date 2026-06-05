/**
 * Shared environment-variable parsing utilities.
 *
 * Every function accepts an optional {@link EnvSource} so tests can inject
 * values without mutating `process.env`.
 *
 * @module
 */

/** A bag of environment variables — defaults to `process.env`. */
export type EnvSource = Record<string, string | undefined>;

function resolve(name: string, env?: EnvSource): string | undefined {
  return (env ?? process.env)[name];
}

/** Read a string env var, returning `fallback` when unset or empty. */
export function envString(name: string, fallback: string, env?: EnvSource): string {
  const raw = resolve(name, env);
  return raw !== undefined && raw !== "" ? raw : fallback;
}

/** Read an optional string env var; returns `undefined` when unset or empty. */
export function envOptionalString(name: string, env?: EnvSource): string | undefined {
  const raw = resolve(name, env);
  return raw !== undefined && raw !== "" ? raw : undefined;
}

/**
 * Parse a port number (integer 1–65535) from an env var.
 * Returns `fallback` when unset. Throws on invalid values.
 */
export function envPort(name: string, fallback: number, env?: EnvSource): number {
  const raw = resolve(name, env);
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port for ${name}: "${raw}". Must be an integer between 1 and 65535.`);
  }
  return parsed;
}

/**
 * Parse an integer env var with optional min/max bounds.
 * Returns `fallback` when unset, non-finite, or outside bounds.
 * Truncates toward zero (matching `parseInt` semantics).
 */
export function envInt(
  name: string,
  fallback: number,
  opts?: { min?: number; max?: number; env?: EnvSource },
): number {
  const raw = resolve(name, opts?.env);
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const value = Math.trunc(parsed);
  if (opts?.min !== undefined && value < opts.min) {
    return fallback;
  }
  if (opts?.max !== undefined && value > opts.max) {
    return fallback;
  }
  return value;
}

/**
 * Parse a non-negative float env var.
 * Returns `fallback` when unset, non-finite, or negative.
 */
export function envNum(name: string, fallback: number, env?: EnvSource): number {
  const raw = resolve(name, env);
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Parse a strict boolean flag: `"1"` → `true`, anything else → `false`.
 * Matches the `GRACKLE_SKIP_*` / `GRACKLE_ALLOW_*` convention.
 */
export function envFlag(name: string, env?: EnvSource): boolean {
  return resolve(name, env) === "1";
}

/**
 * Parse a broad boolean: `"1"` / `"true"` → `true`, `"0"` / `"false"` → `false`,
 * unset/empty/unrecognized → `fallback`. Matches the `GRACKLE_KNOWLEDGE_ENABLED`
 * convention. Unrecognized values preserve the fallback so a typo doesn't
 * silently flip a feature flag.
 */
export function envBool(name: string, fallback: boolean, env?: EnvSource): boolean {
  const raw = resolve(name, env);
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const lower = raw.toLowerCase();
  if (lower === "1" || lower === "true") {
    return true;
  }
  if (lower === "0" || lower === "false") {
    return false;
  }
  return fallback;
}
