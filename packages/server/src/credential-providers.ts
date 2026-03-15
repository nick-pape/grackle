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
      claude: parsed.claude ?? DEFAULT_CONFIG.claude,
      github: parsed.github ?? DEFAULT_CONFIG.github,
      copilot: parsed.copilot ?? DEFAULT_CONFIG.copilot,
      codex: parsed.codex ?? DEFAULT_CONFIG.codex,
    };
  } catch {
    logger.warn("Invalid credential_providers setting; returning defaults");
    return { ...DEFAULT_CONFIG };
  }
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

// ─── Token Bundle Builder ──────────────────────────────────

/**
 * Build a token bundle containing all enabled provider credentials.
 * Reads values fresh from `process.env` or disk at call time.
 */
export function buildProviderTokenBundle(): powerline.TokenBundle {
  const config = getCredentialProviders();
  const items: powerline.TokenItem[] = [];

  // Claude provider
  if (config.claude === "subscription") {
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
  } else if (config.claude === "api_key") {
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
  if (config.github === "on") {
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
  if (config.copilot === "on") {
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
  if (config.codex === "on") {
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

// ─── Gate Helpers ──────────────────────────────────────────

/** Whether the Claude credentials file should be copied during bootstrap. */
export function shouldPushClaudeCredentialsFile(): boolean {
  return getCredentialProviders().claude === "subscription";
}

/** Whether GitHub token should be captured from the remote host during bootstrap. */
export function shouldCaptureRemoteGitHubToken(): boolean {
  return getCredentialProviders().github === "on";
}
