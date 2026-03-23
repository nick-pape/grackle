/**
 * Configurable credential providers — manages which credential providers
 * are enabled and persists the configuration to the database.
 *
 * The token bundle builder that reads `process.env` / disk lives in
 * `@grackle-ai/server` to keep this module a pure persistence layer.
 */
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import db from "./db.js";
import * as schema from "./schema.js";

// ─── Types ─────────────────────────────────────────────────

/** Configuration for which credential providers are enabled. */
export interface CredentialProviderConfig {
  claude: "off" | "subscription" | "api_key";
  github: "off" | "on";
  copilot: "off" | "on";
  codex: "off" | "on";
  goose: "off" | "on";
}

/** Settings table key for credential provider configuration. */
const SETTINGS_KEY: string = "credential_providers";

/** Default configuration — all providers off. */
const DEFAULT_CONFIG: CredentialProviderConfig = {
  claude: "off",
  github: "off",
  copilot: "off",
  codex: "off",
  goose: "off",
};

/** Valid provider names. */
export const VALID_PROVIDERS: readonly string[] = ["claude", "github", "copilot", "codex", "goose"];

/** Valid values for the Claude provider. */
export const VALID_CLAUDE_VALUES: ReadonlySet<string> = new Set(["off", "subscription", "api_key"]);

/** Valid values for toggle-style providers (github, copilot, codex). */
export const VALID_TOGGLE_VALUES: ReadonlySet<string> = new Set(["off", "on"]);

/** Drizzle database instance type used by credential-provider functions. */
export type DatabaseInstance = BetterSQLite3Database<typeof schema>;

// ─── Read / Write ──────────────────────────────────────────

/**
 * Parse a raw JSON string into a validated {@link CredentialProviderConfig}.
 * Invalid or missing fields fall back to {@link DEFAULT_CONFIG} values.
 * Throws if the JSON is syntactically invalid — callers decide how to handle the error.
 * Non-object values (e.g. `"null"`, `"42"`) are treated as empty and fall back to defaults.
 */
export function parseCredentialProviderConfig(rawJson: string): CredentialProviderConfig {
  const raw = JSON.parse(rawJson) as unknown;
  const parsed = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<CredentialProviderConfig>;
  return {
    claude: VALID_CLAUDE_VALUES.has(parsed.claude ?? "") ? parsed.claude! : DEFAULT_CONFIG.claude,
    github: VALID_TOGGLE_VALUES.has(parsed.github ?? "") ? parsed.github! : DEFAULT_CONFIG.github,
    copilot: VALID_TOGGLE_VALUES.has(parsed.copilot ?? "") ? parsed.copilot! : DEFAULT_CONFIG.copilot,
    codex: VALID_TOGGLE_VALUES.has(parsed.codex ?? "") ? parsed.codex! : DEFAULT_CONFIG.codex,
    goose: VALID_TOGGLE_VALUES.has(parsed.goose ?? "") ? parsed.goose! : DEFAULT_CONFIG.goose,
  };
}

/**
 * Read the current credential provider configuration from the database.
 * @param database - Optional Drizzle instance; defaults to the module-level db.
 */
export function getCredentialProviders(database?: DatabaseInstance): CredentialProviderConfig {
  const conn = database ?? db;
  const row = conn
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, SETTINGS_KEY))
    .get();

  if (!row) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    return parseCredentialProviderConfig(row.value);
  } catch {
    process.stderr.write("Invalid credential_providers setting; returning defaults\n");
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Validate that a value is a well-formed credential provider config.
 * Returns true if all fields have valid values.
 */
export function isValidCredentialProviderConfig(value: unknown): value is CredentialProviderConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    VALID_CLAUDE_VALUES.has(v.claude as string) &&
    VALID_TOGGLE_VALUES.has(v.github as string) &&
    VALID_TOGGLE_VALUES.has(v.copilot as string) &&
    VALID_TOGGLE_VALUES.has(v.codex as string) &&
    VALID_TOGGLE_VALUES.has(v.goose as string)
  );
}

/**
 * Persist credential provider configuration to the database.
 * @param database - Optional Drizzle instance; defaults to the module-level db.
 */
export function setCredentialProviders(config: CredentialProviderConfig, database?: DatabaseInstance): void {
  const conn = database ?? db;
  const value = JSON.stringify(config);
  conn.insert(schema.settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value },
    })
    .run();
}


