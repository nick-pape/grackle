/**
 * Builds token bundles from enabled credential providers by reading
 * `process.env` and credential files from disk.
 *
 * Separated from {@link ./credential-providers.ts} (persistence layer) and
 * {@link ./token-push.ts} (network orchestration) to keep each module
 * focused on a single concern.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { powerline, type RuntimeName } from "@grackle-ai/common";
import { getCredentialProviders, type CredentialProviderConfig, type DatabaseInstance } from "./credential-providers.js";

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
    const isWindows = process.platform === "win32";
    const gooseConfigPath = isWindows
      ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Block", "goose", "config", "config.yaml")
      : join(homedir(), ".config", "goose", "config.yaml");
    const gooseConfigFilePath = isWindows
      ? "%APPDATA%/Block/goose/config/config.yaml"
      : "~/.config/goose/config.yaml";
    if (existsSync(gooseConfigPath)) {
      const value = readFileSync(gooseConfigPath, "utf-8");
      if (value.trim()) {
        items.push(
          create(powerline.TokenItemSchema, {
            name: "goose-config",
            type: "file",
            filePath: gooseConfigFilePath,
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
