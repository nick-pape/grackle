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
import { type RuntimeName } from "@grackle-ai/common";
import {
  credentialProviders,
  githubAccountStore,
  type CredentialProviderConfig,
  type DatabaseInstance,
} from "@grackle-ai/database";
import { exec } from "./utils/exec.js";

/**
 * A single credential token, structurally compatible with both the legacy
 * `powerline.TokenItem` proto message and the AHP-shaped
 * `AuthenticateTokenItem` exported by `@grackle-ai/adapter-sdk`.
 */
export interface TokenItem {
  /** Logical name of the token (e.g. "github-token"). */
  name: string;
  /** Delivery kind ("env_var" or "file"). */
  type: string;
  /** Environment variable name (when `type === "env_var"`). */
  envVar?: string;
  /** Target file path on the remote (when `type === "file"`). */
  filePath?: string;
  /** The credential value. */
  value: string;
  /**
   * The credential-provider block that materialized this token. Server-internal
   * source tag used by {@link findUnsatisfiedNeeds} to decide whether a runtime's
   * advertised needs are met; it is **never delivered** over the wire (the
   * `authenticate` mapper picks only `name`/`type`/`envVar`/`filePath`/`value`).
   */
  provider?: keyof CredentialProviderConfig;
}

/** A bundle of tokens — the return shape of {@link buildProviderTokenBundle}. */
export interface ProviderTokenBundle {
  /** The collected token items, in the order they should be delivered. */
  tokens: TokenItem[];
}

/** Type-asserting identity helper; replaces the proto-bound `create()` factory. */
function tokenItem(data: TokenItem): TokenItem {
  return data;
}

/**
 * Maps each runtime to the credential providers it needs.
 * @internal Exported for catalog-coherence testing (every key must be a {@link RUNTIME_CATALOG} entry).
 */
export const RUNTIME_PROVIDERS: Record<string, (keyof CredentialProviderConfig)[]> = {
  "claude-code": ["claude", "github"],
  copilot: ["copilot", "github"],
  codex: ["codex", "github"],
  goose: ["goose", "github"],
  stub: [],
  // ACP runtimes (experimental) — auth via ACP authenticate method, not credential files
  "claude-code-acp": ["claude", "github"],
  "codex-acp": ["codex", "github"],
  "copilot-acp": ["copilot", "github"],
};

/**
 * How a credential is delivered to a runtime. Grackle extension carried in the
 * AHP `protectedResources._meta` field (RFC 9728 alone cannot express a local
 * credential file vs. an env API key vs. a true OAuth-server flow).
 */
export type CredentialKind = "env-api-key" | "oauth-subscription-file" | "oauth-server";

/**
 * A declarative description of a credential a runtime requires — the
 * advertise-needs half of {@link buildProviderTokenBundle}, with **no secrets
 * read**. Maps onto AHP `ProtectedResourceMetadata` (RFC 9728) for a runtime's
 * `AgentInfo.protectedResources`.
 */
export interface ProtectedResourceDescriptor {
  /** RFC 9728 resource identifier (an `https` URL). */
  resource: string;
  /** Human-readable resource name. */
  resourceName: string;
  /** OAuth authorization servers (RFC 9728); empty for env/file credential kinds. */
  authorizationServers: string[];
  /** OAuth scopes (RFC 9728); empty for env/file credential kinds. */
  scopesSupported: string[];
  /**
   * Acceptable credential kinds — the need is satisfied by **any** of these (e.g.
   * codex accepts an OAuth file *or* an API-key env var). Mirrors what
   * {@link buildProviderTokenBundle} will actually materialize for the provider.
   * The presence/expiry check itself is the consumer's job (#1316).
   */
  credentialKinds: CredentialKind[];
  /** The credential-provider key this need derives from. */
  provider: keyof CredentialProviderConfig;
}

/**
 * Describe the credential a single provider requires given the current config,
 * or `undefined` when that provider is disabled. Pure — derived from config
 * only, reads no secrets.
 */
function describeProviderNeed(
  provider: keyof CredentialProviderConfig,
  config: CredentialProviderConfig,
): ProtectedResourceDescriptor | undefined {
  switch (provider) {
    case "claude": {
      if (config.claude === "off") {
        return undefined;
      }
      return {
        resource: "https://api.anthropic.com",
        resourceName: "Anthropic API",
        authorizationServers: [],
        scopesSupported: [],
        credentialKinds: [
          config.claude === "subscription" ? "oauth-subscription-file" : "env-api-key",
        ],
        provider: "claude",
      };
    }
    case "github": {
      if (config.github !== "on") {
        return undefined;
      }
      return {
        resource: "https://api.github.com",
        resourceName: "GitHub",
        authorizationServers: [],
        scopesSupported: [],
        credentialKinds: ["env-api-key"],
        provider: "github",
      };
    }
    case "copilot": {
      if (config.copilot !== "on") {
        return undefined;
      }
      return {
        resource: "https://api.githubcopilot.com",
        resourceName: "GitHub Copilot",
        authorizationServers: [],
        scopesSupported: [],
        credentialKinds: ["oauth-subscription-file", "env-api-key"],
        provider: "copilot",
      };
    }
    case "codex": {
      if (config.codex !== "on") {
        return undefined;
      }
      return {
        resource: "https://api.openai.com",
        resourceName: "OpenAI",
        authorizationServers: [],
        scopesSupported: [],
        credentialKinds: ["oauth-subscription-file", "env-api-key"],
        provider: "codex",
      };
    }
    case "goose": {
      if (config.goose !== "on") {
        return undefined;
      }
      return {
        resource: "https://block.github.io/goose",
        resourceName: "Goose",
        authorizationServers: [],
        scopesSupported: [],
        credentialKinds: ["oauth-subscription-file", "env-api-key"],
        provider: "goose",
      };
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Derive the credential needs a runtime advertises, given the credential-provider
 * config — the AHP `protectedResources` for a runtime's `AgentInfo`. Emits a
 * descriptor for each **enabled** provider mapped to the runtime (matching #1316's
 * "provider enabled" pre-flight trigger). Unknown/stub runtimes return `[]`.
 *
 * **Pure**: derived from `config` only — reads no env vars, files, or the
 * credential store. Contrast with {@link buildProviderTokenBundle}, which
 * materializes the actual secret values.
 */
export function deriveCredentialNeeds(
  runtime: string,
  config: CredentialProviderConfig,
): ProtectedResourceDescriptor[] {
  const providers = Object.hasOwn(RUNTIME_PROVIDERS, runtime)
    ? RUNTIME_PROVIDERS[runtime as RuntimeName]
    : [];
  const needs: ProtectedResourceDescriptor[] = [];
  for (const provider of providers) {
    const descriptor = describeProviderNeed(provider, config);
    if (descriptor !== undefined) {
      needs.push(descriptor);
    }
  }
  return needs;
}

// ─── Pre-flight credential validation (#1316) ──────────────

/** Clock-skew buffer: treat a credential expiring within this window as already expired. */
const CREDENTIAL_EXPIRY_SKEW_MS: number = 60_000;

/**
 * The expiry state of a credential, as far as is knowable from a purely offline
 * inspection of a credential file. Only the OAuth-file providers (Claude
 * subscription, Codex) carry an embedded, parseable expiry; for every other
 * credential kind (API keys, GitHub/Copilot/Goose tokens) expiry is not knowable
 * offline and inspection returns `"unknown"`.
 *
 * - `valid` — present and not past expiry.
 * - `expired-recoverable` — past expiry but a refresh token is present, so the
 *   runtime transparently refreshes it on launch (not a spawn blocker).
 * - `expired-unrecoverable` — past expiry with no refresh token; re-login required
 *   (the genuine "will 401 deep in the runtime" case worth failing fast on).
 * - `unknown` — expiry is not offline-knowable, or the file shape is unexpected
 *   (fail open: never treated as a blocker).
 */
export type CredentialExpiryState =
  | "valid"
  | "expired-recoverable"
  | "expired-unrecoverable"
  | "unknown";

/**
 * Decode a JWT payload **without verifying its signature**, returning the parsed
 * claims or `undefined` when the token is not a well-formed three-segment JWT.
 * Offline only — we trust the locally stored file and only read the `exp` claim.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return undefined;
  }
  try {
    const json = Buffer.from(segments[1], "base64url").toString("utf-8");
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Inspect a Claude subscription credentials file (`~/.claude/.credentials.json`):
 * the OAuth access token's `expiresAt` is a unix-ms timestamp sibling to a
 * `refreshToken`. Fails open (`"unknown"`) on any unexpected shape.
 */
function inspectClaudeCredentials(value: string, now: number): CredentialExpiryState {
  let oauth: { expiresAt?: unknown; refreshToken?: unknown; accessToken?: unknown } | undefined;
  try {
    // A non-object parse (`null`, a primitive) throws on property access and is
    // caught below, yielding "unknown" — exactly the fail-open behavior we want.
    const parsed = JSON.parse(value) as { claudeAiOauth?: typeof oauth };
    oauth = parsed.claudeAiOauth;
  } catch {
    return "unknown";
  }
  if (!oauth || typeof oauth.accessToken !== "string" || typeof oauth.expiresAt !== "number") {
    return "unknown";
  }
  if (oauth.expiresAt >= now + CREDENTIAL_EXPIRY_SKEW_MS) {
    return "valid";
  }
  return typeof oauth.refreshToken === "string" && oauth.refreshToken.length > 0
    ? "expired-recoverable"
    : "expired-unrecoverable";
}

/**
 * Inspect a Codex auth file (`~/.codex/auth.json`): `tokens.access_token` is a
 * JWT whose `exp` claim (unix seconds) carries the expiry, sibling to a
 * `refresh_token`. Fails open (`"unknown"`) on any unexpected shape — the token
 * format is owned by the Codex runtime and may drift.
 */
function inspectCodexAuth(value: string, now: number): CredentialExpiryState {
  let tokens: { access_token?: unknown; refresh_token?: unknown } | undefined;
  try {
    const parsed = JSON.parse(value) as { tokens?: typeof tokens };
    tokens = parsed.tokens;
  } catch {
    return "unknown";
  }
  if (!tokens || typeof tokens.access_token !== "string") {
    return "unknown";
  }
  const exp = decodeJwtPayload(tokens.access_token)?.exp;
  if (typeof exp !== "number") {
    return "unknown";
  }
  if (exp * 1000 >= now + CREDENTIAL_EXPIRY_SKEW_MS) {
    return "valid";
  }
  return typeof tokens.refresh_token === "string" && tokens.refresh_token.length > 0
    ? "expired-recoverable"
    : "expired-unrecoverable";
}

/**
 * Determine the offline-knowable {@link CredentialExpiryState} of a materialized
 * credential {@link TokenItem}. Only OAuth-file tokens (`claude-credentials`,
 * `codex-auth`) carry a parseable expiry; every other token returns `"unknown"`
 * because expiry is not derivable without a network call. Pure; fails open.
 */
export function inspectFileCredentialExpiry(token: TokenItem, now: number): CredentialExpiryState {
  if (token.type !== "file") {
    return "unknown";
  }
  switch (token.name) {
    case "claude-credentials": {
      return inspectClaudeCredentials(token.value, now);
    }
    case "codex-auth": {
      return inspectCodexAuth(token.value, now);
    }
    default: {
      return "unknown";
    }
  }
}

/** A credential need that the materialized bundle does not satisfy, with the reason. */
export interface UnsatisfiedNeed {
  /** The advertised need that is not met. */
  need: ProtectedResourceDescriptor;
  /** Why the need is unmet: no credential at all, or an expired non-refreshable one. */
  reason: "missing" | "expired";
}

/**
 * Cross-check a runtime's advertised {@link ProtectedResourceDescriptor needs}
 * against the credentials a {@link buildProviderTokenBundle} actually materialized,
 * returning the needs that are not satisfied. A need is unsatisfied when:
 *
 * - **missing** — the bundle contains no token tagged for the need's provider, or
 * - **expired** — the provider materialized credential(s) but **every** one is an
 *   expired OAuth file with no refresh token (re-login required).
 *
 * A token counts as usable unless it is `expired-unrecoverable` — a refreshable
 * expiry (the runtime refreshes on launch) and an `unknown`-expiry token (e.g. an
 * API key, whose expiry is not offline-knowable) both satisfy the need. So when a
 * provider emits more than one credential (e.g. Codex emits both `~/.codex/auth.json`
 * *and* `OPENAI_API_KEY`), a stale OAuth file does not fail the spawn as long as a
 * working fallback is present.
 *
 * Pure: derives entirely from `needs` + `bundle` + `now`, reads nothing.
 */
export function findUnsatisfiedNeeds(
  needs: ProtectedResourceDescriptor[],
  bundle: ProviderTokenBundle,
  now: number,
): UnsatisfiedNeed[] {
  const unsatisfied: UnsatisfiedNeed[] = [];
  for (const need of needs) {
    const tokens = bundle.tokens.filter((t) => t.provider === need.provider);
    if (tokens.length === 0) {
      unsatisfied.push({ need, reason: "missing" });
      continue;
    }
    // Report expired only when there is no usable credential — i.e. every token
    // for the provider is an expired, non-refreshable OAuth file.
    if (tokens.every((t) => inspectFileCredentialExpiry(t, now) === "expired-unrecoverable")) {
      unsatisfied.push({ need, reason: "expired" });
    }
  }
  return unsatisfied;
}

/**
 * Build a human-readable, actionable pre-flight error message for credentials
 * that are required but missing or expired — surfaced to the CLI and web before
 * a spawn instead of as an opaque 401 deep inside the runtime.
 */
export function formatPreflightCredentialError(
  runtime: string,
  unsatisfied: UnsatisfiedNeed[],
): string {
  const lines = unsatisfied.map(({ need, reason }) => {
    const subject = `${need.resourceName} (provider "${need.provider}")`;
    return reason === "missing"
      ? `  • ${subject}: enabled but no credential was found`
      : `  • ${subject}: login expired and cannot be refreshed — re-login required`;
  });
  return (
    `Cannot start runtime "${runtime}": required credential(s) unavailable.\n` +
    `${lines.join("\n")}\n` +
    `Configure or disable the provider with \`grackle credential-provider set <provider> <value>\`, then retry.`
  );
}

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
export async function buildProviderTokenBundle(
  runtime?: string,
  database?: DatabaseInstance,
  githubAccountId?: string,
): Promise<ProviderTokenBundle> {
  const config = credentialProviders.getCredentialProviders(database);
  // When runtime is given, look it up in the map. Unknown runtimes get [] (empty, not all providers).
  const runtimeProviders =
    runtime !== undefined
      ? Object.hasOwn(RUNTIME_PROVIDERS, runtime)
        ? RUNTIME_PROVIDERS[runtime as RuntimeName]
        : []
      : undefined;
  const allowedProviders = runtimeProviders !== undefined ? new Set(runtimeProviders) : undefined;
  const items: TokenItem[] = [];

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
          tokenItem({
            name: "claude-credentials",
            type: "file",
            filePath: "~/.claude/.credentials.json",
            value,
            provider: "claude",
          }),
        );
      }
    }
  } else if ((!allowedProviders || allowedProviders.has("claude")) && config.claude === "api_key") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      items.push(
        tokenItem({
          name: "anthropic-api-key",
          type: "env_var",
          envVar: "ANTHROPIC_API_KEY",
          value: apiKey,
          provider: "claude",
        }),
      );
    }
  }

  // GitHub provider
  if ((!allowedProviders || allowedProviders.has("github")) && config.github === "on") {
    // When a specific GitHub account is requested, resolve its token from the store.
    // The fallback chain (default account → env vars → gh CLI) is handled by
    // githubAccountStore.resolveStoredGitHubToken().
    const storedToken =
      githubAccountId !== undefined || githubAccountStore.getDefaultGitHubAccount() !== undefined
        ? githubAccountStore.resolveStoredGitHubToken(githubAccountId || undefined)
        : undefined;

    if (storedToken) {
      items.push(
        tokenItem({
          name: "github-token",
          type: "env_var",
          envVar: "GH_TOKEN",
          value: storedToken,
          provider: "github",
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
            tokenItem({
              name: varName.toLowerCase().replace(/_/g, "-"),
              type: "env_var",
              envVar: varName,
              value,
              provider: "github",
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
            tokenItem({
              name: "github-token",
              type: "env_var",
              envVar: "GITHUB_TOKEN",
              value: cliToken,
              provider: "github",
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
          tokenItem({
            name: "copilot-config",
            type: "file",
            filePath: "~/.copilot/config.json",
            value,
            provider: "copilot",
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
          tokenItem({
            name: varName.toLowerCase().replace(/_/g, "-"),
            type: "env_var",
            envVar: varName,
            value,
            provider: "copilot",
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
            tokenItem({
              name: envVarName.toLowerCase().replace(/_/g, "-"),
              type: "env_var",
              envVar: envVarName,
              value: envToken,
              provider: "copilot",
            }),
          );
        }
      } else {
        const cliToken = await getCliToken();
        if (cliToken && !items.some((item) => item.envVar === "GITHUB_TOKEN")) {
          items.push(
            tokenItem({
              name: "github-token",
              type: "env_var",
              envVar: "GITHUB_TOKEN",
              value: cliToken,
              provider: "copilot",
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
          tokenItem({
            name: "codex-auth",
            type: "file",
            filePath: "~/.codex/auth.json",
            value,
            provider: "codex",
          }),
        );
      }
    }
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      items.push(
        tokenItem({
          name: "openai-api-key",
          type: "env_var",
          envVar: "OPENAI_API_KEY",
          value: openaiKey,
          provider: "codex",
        }),
      );
    }
  }

  // Goose provider — forward config file and provider-related env vars.
  // Goose is provider-agnostic so we forward whichever API keys are available.
  if ((!allowedProviders || allowedProviders.has("goose")) && config.goose === "on") {
    const isWindows = process.platform === "win32";
    const gooseConfigPath = isWindows
      ? join(
          process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
          "Block",
          "goose",
          "config",
          "config.yaml",
        )
      : join(homedir(), ".config", "goose", "config.yaml");
    const gooseConfigFilePath = isWindows
      ? "%APPDATA%/Block/goose/config/config.yaml"
      : "~/.config/goose/config.yaml";
    if (existsSync(gooseConfigPath)) {
      const value = readFileSync(gooseConfigPath, "utf-8");
      if (value.trim()) {
        items.push(
          tokenItem({
            name: "goose-config",
            type: "file",
            filePath: gooseConfigFilePath,
            value,
            provider: "goose",
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
          tokenItem({
            name: varName.toLowerCase().replace(/_/g, "-"),
            type: "env_var",
            envVar: varName,
            value,
            provider: "goose",
          }),
        );
      }
    }
  }

  return { tokens: items };
}
