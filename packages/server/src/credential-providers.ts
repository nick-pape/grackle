/**
 * Configurable credential providers — manages which credentials are
 * automatically forwarded to remote environments at task start.
 */
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { powerline, type RuntimeName } from "@grackle-ai/common";
import db from "./db.js";
import * as schema from "./schema.js";
import { logger } from "./logger.js";

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
    logger.warn("Invalid credential_providers setting; returning defaults");
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

// ─── Runtime → Provider Mapping ────────────────────────────

/** Maps each runtime to the credential providers it needs. */
const RUNTIME_PROVIDERS: Record<string, (keyof CredentialProviderConfig)[]> = {
  "claude-code": ["claude", "github"],
  "copilot": ["copilot", "github"],
  "codex": ["codex", "github"],
  "goose": ["goose", "github"],
  "stub": [],
  // ACP runtimes (experimental) — auth via ACP authenticate method, not credential files
  "claude-code-acp": ["claude", "github"],
  "codex-acp": ["codex", "github"],
  "copilot-acp": ["copilot", "github"],
};

// ─── Token Bundle Builder ──────────────────────────────────

/**
 * Build a token bundle containing enabled provider credentials.
 * When `runtime` is a known {@link RuntimeName}, only providers mapped to that runtime are included.
 * When `runtime` is omitted, all enabled providers are included.
 * When `runtime` is provided but not a recognized {@link RuntimeName}, no providers are included
 * (fails safe rather than exposing all credentials for an unrecognized runtime).
 * Reads values fresh from `process.env` or disk at call time.
 */
export function buildProviderTokenBundle(runtime?: string, database?: DatabaseInstance): powerline.TokenBundle {
  const config = getCredentialProviders(database);
  // When runtime is given, look it up in the map. Unknown runtimes get [] (empty, not all providers).
  const runtimeProviders = runtime !== undefined
    ? (Object.hasOwn(RUNTIME_PROVIDERS, runtime) ? RUNTIME_PROVIDERS[runtime as RuntimeName] : [])
    : undefined;
  const allowedProviders = runtimeProviders !== undefined
    ? new Set(runtimeProviders)
    : undefined;
  const items: powerline.TokenItem[] = [];

  // Claude provider
  if ((!allowedProviders || allowedProviders.has("claude")) && config.claude === "subscription") {
    const credentialsPath = join(homedir(), ".claude", ".credentials.json");
    if (existsSync(credentialsPath)) {
      const value = readFileSync(credentialsPath, "utf-8");
      if (value.trim()) {
        items.push(
          create(powerline.TokenItemSchema, {
            name: "claude-credentials",
            type: "file",
            filePath: "~/.claude/.credentials.json",
            value,
          }),
        );
      }
    }
  } else if ((!allowedProviders || allowedProviders.has("claude")) && config.claude === "api_key") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      items.push(
        create(powerline.TokenItemSchema, {
          name: "anthropic-api-key",
          type: "env_var",
          envVar: "ANTHROPIC_API_KEY",
          value: apiKey,
        }),
      );
    }
  }

  // GitHub provider
  if ((!allowedProviders || allowedProviders.has("github")) && config.github === "on") {
    for (const varName of ["GITHUB_TOKEN", "GH_TOKEN"]) {
      const value = process.env[varName];
      if (value) {
        items.push(
          create(powerline.TokenItemSchema, {
            name: varName.toLowerCase().replace(/_/g, "-"),
            type: "env_var",
            envVar: varName,
            value,
          }),
        );
      }
    }
  }

  // Copilot provider — push the config file so the SDK's useLoggedInUser path works.
  // Also forward env vars for explicit token / BYOK scenarios.
  if ((!allowedProviders || allowedProviders.has("copilot")) && config.copilot === "on") {
    const copilotConfigPath = join(homedir(), ".copilot", "config.json");
    if (existsSync(copilotConfigPath)) {
      const value = readFileSync(copilotConfigPath, "utf-8");
      if (value.trim()) {
        items.push(
          create(powerline.TokenItemSchema, {
            name: "copilot-config",
            type: "file",
            filePath: "~/.copilot/config.json",
            value,
          }),
        );
      }
    }
    for (const varName of [
      "COPILOT_GITHUB_TOKEN",
      "COPILOT_CLI_URL",
      "COPILOT_CLI_PATH",
      "COPILOT_PROVIDER_CONFIG",
    ]) {
      const value = process.env[varName];
      if (value) {
        items.push(
          create(powerline.TokenItemSchema, {
            name: varName.toLowerCase().replace(/_/g, "-"),
            type: "env_var",
            envVar: varName,
            value,
          }),
        );
      }
    }
  }

  // Codex provider — push the auth file so the SDK's ChatGPT auth path works.
  // Also forward OPENAI_API_KEY env var for API-key scenarios.
  if ((!allowedProviders || allowedProviders.has("codex")) && config.codex === "on") {
    const codexAuthPath = join(homedir(), ".codex", "auth.json");
    if (existsSync(codexAuthPath)) {
      const value = readFileSync(codexAuthPath, "utf-8");
      if (value.trim()) {
        items.push(
          create(powerline.TokenItemSchema, {
            name: "codex-auth",
            type: "file",
            filePath: "~/.codex/auth.json",
            value,
          }),
        );
      }
    }
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      items.push(
        create(powerline.TokenItemSchema, {
          name: "openai-api-key",
          type: "env_var",
          envVar: "OPENAI_API_KEY",
          value: openaiKey,
        }),
      );
    }
  }

  // Goose provider — forward config file and provider-related env vars.
  // Goose is provider-agnostic so we forward whichever API keys are available.
  if ((!allowedProviders || allowedProviders.has("goose")) && config.goose === "on") {
    const gooseConfigPath = process.platform === "win32"
      ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Block", "goose", "config", "config.yaml")
      : join(homedir(), ".config", "goose", "config.yaml");
    if (existsSync(gooseConfigPath)) {
      const value = readFileSync(gooseConfigPath, "utf-8");
      if (value.trim()) {
        items.push(
          create(powerline.TokenItemSchema, {
            name: "goose-config",
            type: "file",
            filePath: "~/.config/goose/config.yaml",
            value,
          }),
        );
      }
    }
    for (const varName of [
      "GOOSE_PROVIDER",
      "GOOSE_MODEL",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GOOGLE_API_KEY",
    ]) {
      const value = process.env[varName];
      if (value) {
        items.push(
          create(powerline.TokenItemSchema, {
            name: varName.toLowerCase().replace(/_/g, "-"),
            type: "env_var",
            envVar: varName,
            value,
          }),
        );
      }
    }
  }

  return create(powerline.TokenBundleSchema, { tokens: items });
}

