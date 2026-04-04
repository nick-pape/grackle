/**
 * Builds token bundles from enabled credential providers by reading
 * `process.env`, credential files from disk, and (as a fallback) the
 * `gh` CLI's credential store.
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
import { credentialProviders, githubAccountStore, type CredentialProviderConfig, type DatabaseInstance } from "@grackle-ai/database";
import { exec } from "./utils/exec.js";

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

/** Timeout for the `gh auth token` subprocess call. */
const GH_AUTH_TOKEN_TIMEOUT_MS: number = 5_000;

/**
 * Resolve a GitHub token from the `gh` CLI's credential store.
 * Returns `undefined` if the CLI is unavailable, not authenticated, or errors.
 * @internal Exported for testing.
 */
export async function resolveGitHubTokenFromCli(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("gh", ["auth", "token"], { timeout: GH_AUTH_TOKEN_TIMEOUT_MS });
    return stdout || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build a token bundle containing enabled provider credentials.
 * When `runtime` is a known {@link RuntimeName}, only providers mapped to that runtime are included.
 * When `runtime` is omitted, all enabled providers are included.
 * When `runtime` is provided but not a recognized {@link RuntimeName}, no providers are included
 * (fails safe rather than exposing all credentials for an unrecognized runtime).
 * When `githubAccountId` is provided, the GitHub token is resolved from the stored account
 * rather than from environment variables, enabling per-environment identity selection.
 * Reads values fresh from `process.env`, disk, or the `gh` CLI at call time.
 */
export async function buildProviderTokenBundle(runtime?: string, database?: DatabaseInstance, githubAccountId?: string): Promise<powerline.TokenBundle> {
  const config = credentialProviders.getCredentialProviders(database);
  // When runtime is given, look it up in the map. Unknown runtimes get [] (empty, not all providers).
  const runtimeProviders = runtime !== undefined
    ? (Object.hasOwn(RUNTIME_PROVIDERS, runtime) ? RUNTIME_PROVIDERS[runtime as RuntimeName] : [])
    : undefined;
  const allowedProviders = runtimeProviders !== undefined
    ? new Set(runtimeProviders)
    : undefined;
  const items: powerline.TokenItem[] = [];

  // Lazily resolved GitHub token from the `gh` CLI — shared across provider blocks
  // to avoid spawning the subprocess more than once per call. Stores a Promise
  // (not the resolved value) so concurrent reads share the same in-flight call.
  let cliTokenPromise: Promise<string | undefined> | undefined;
  function getCliToken(): Promise<string | undefined> {
    if (!cliTokenPromise) {
      cliTokenPromise = resolveGitHubTokenFromCli();
    }
    return cliTokenPromise;
  }

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
    // When a specific GitHub account is requested, resolve its token from the store.
    // The fallback chain (default account → env vars → gh CLI) is handled by
    // githubAccountStore.resolveStoredGitHubToken().
    const storedToken = githubAccountId !== undefined || githubAccountStore.getDefaultGitHubAccount() !== undefined
      ? githubAccountStore.resolveStoredGitHubToken(githubAccountId || undefined)
      : undefined;

    if (storedToken) {
      items.push(
        create(powerline.TokenItemSchema, {
          name: "github-token",
          type: "env_var",
          envVar: "GH_TOKEN",
          value: storedToken,
        }),
      );
    } else {
      // No stored accounts — fall back to environment variables and gh CLI.
      let hasGitHubEnvVar = false;
      for (const varName of ["GITHUB_TOKEN", "GH_TOKEN"]) {
        const value = process.env[varName];
        if (value) {
          hasGitHubEnvVar = true;
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
      // Fallback: resolve from `gh auth token` when no env vars are set.
      // This covers dev workstations where `gh auth login` stores tokens in the
      // gh CLI config rather than in GITHUB_TOKEN / GH_TOKEN env vars.
      if (!hasGitHubEnvVar) {
        const cliToken = await getCliToken();
        if (cliToken) {
          items.push(
            create(powerline.TokenItemSchema, {
              name: "github-token",
              type: "env_var",
              envVar: "GITHUB_TOKEN",
              value: cliToken,
            }),
          );
        }
      }
    }
  }

  // Copilot provider — push the config file and forward env vars.
  // Also ensures a GitHub token is available for Copilot auth, even when the
  // GitHub credential provider is disabled. Without a token, the Copilot SDK
  // falls back to `useLoggedInUser` which fails on Docker / SSH environments
  // that lack platform-injected GITHUB_TOKEN. (See #534.)
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
    let hasGitHubToken = false;
    for (const varName of [
      "COPILOT_GITHUB_TOKEN",
      "COPILOT_CLI_URL",
      "COPILOT_CLI_PATH",
      "COPILOT_PROVIDER_CONFIG",
    ]) {
      const value = process.env[varName];
      if (value) {
        if (varName === "COPILOT_GITHUB_TOKEN") {
          hasGitHubToken = true;
        }
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
    // Ensure Copilot gets a GitHub token for SDK authentication even when the
    // GitHub credential provider is disabled. Check env vars first, then fall
    // back to `gh auth token`. The Copilot SDK's resolveGithubToken() checks
    // COPILOT_GITHUB_TOKEN → GH_TOKEN → GITHUB_TOKEN, so pushing GITHUB_TOKEN
    // covers the fallback path.
    if (!hasGitHubToken) {
      const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
      if (envToken) {
        const envVarName = process.env.GH_TOKEN ? "GH_TOKEN" : "GITHUB_TOKEN";
        // Only push if not already included by the GitHub provider block above
        if (!items.some((item) => item.envVar === envVarName)) {
          items.push(
            create(powerline.TokenItemSchema, {
              name: envVarName.toLowerCase().replace(/_/g, "-"),
              type: "env_var",
              envVar: envVarName,
              value: envToken,
            }),
          );
        }
      } else {
        const cliToken = await getCliToken();
        if (cliToken && !items.some((item) => item.envVar === "GITHUB_TOKEN")) {
          items.push(
            create(powerline.TokenItemSchema, {
              name: "github-token",
              type: "env_var",
              envVar: "GITHUB_TOKEN",
              value: cliToken,
            }),
          );
        }
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
