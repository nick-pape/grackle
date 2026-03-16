/**
 * Configurable credential providers — manages which credentials are
 * automatically forwarded to remote environments at task start.
 */
import { eq } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { powerline } from "@grackle-ai/common";
import db from "./db.js";
import { settings } from "./schema.js";
import { logger } from "./logger.js";

// ─── Types ─────────────────────────────────────────────────

/** Configuration for which credential providers are enabled. */
export interface CredentialProviderConfig {
  claude: "off" | "subscription" | "api_key";
  github: "off" | "on";
  copilot: "off" | "on";
  codex: "off" | "on";
}

/** Settings table key for credential provider configuration. */
const SETTINGS_KEY: string = "credential_providers";

/** Default configuration — all providers off. */
const DEFAULT_CONFIG: CredentialProviderConfig = {
  claude: "off",
  github: "off",
  copilot: "off",
  codex: "off",
};

/** Valid values for each provider field. */
const VALID_CLAUDE_VALUES: ReadonlySet<string> = new Set(["off", "subscription", "api_key"]);
const VALID_TOGGLE_VALUES: ReadonlySet<string> = new Set(["off", "on"]);

// ─── Read / Write ──────────────────────────────────────────

/** Read the current credential provider configuration from the database. */
export function getCredentialProviders(): CredentialProviderConfig {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, SETTINGS_KEY))
    .get();

  if (!row) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const parsed = JSON.parse(row.value) as Partial<CredentialProviderConfig>;
    return {
      claude: VALID_CLAUDE_VALUES.has(parsed.claude ?? "") ? parsed.claude! : DEFAULT_CONFIG.claude,
      github: VALID_TOGGLE_VALUES.has(parsed.github ?? "") ? parsed.github! : DEFAULT_CONFIG.github,
      copilot: VALID_TOGGLE_VALUES.has(parsed.copilot ?? "") ? parsed.copilot! : DEFAULT_CONFIG.copilot,
      codex: VALID_TOGGLE_VALUES.has(parsed.codex ?? "") ? parsed.codex! : DEFAULT_CONFIG.codex,
    };
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
    VALID_TOGGLE_VALUES.has(v.codex as string)
  );
}

/** Persist credential provider configuration to the database. */
export function setCredentialProviders(config: CredentialProviderConfig): void {
  const value = JSON.stringify(config);
  db.insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({
      target: settings.key,
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
};

// ─── Token Bundle Builder ──────────────────────────────────

/**
 * Build a token bundle containing enabled provider credentials.
 * When `runtime` is specified, only providers relevant to that runtime are included.
 * When `runtime` is omitted or unknown, all enabled providers are included.
 * Reads values fresh from `process.env` or disk at call time.
 */
export function buildProviderTokenBundle(runtime?: string): powerline.TokenBundle {
  const config = getCredentialProviders();
  const runtimeProviders = runtime ? RUNTIME_PROVIDERS[runtime] : undefined;
  const allowedProviders = runtimeProviders
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

  // Copilot provider
  if ((!allowedProviders || allowedProviders.has("copilot")) && config.copilot === "on") {
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

  // Codex provider
  if ((!allowedProviders || allowedProviders.has("codex")) && config.codex === "on") {
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

  return create(powerline.TokenBundleSchema, { tokens: items });
}

