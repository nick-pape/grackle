/**
 * Pure credential-needs derivation — maps runtimes to their advertised
 * credential requirements (AHP `protectedResources` / RFC 9728).
 *
 * No side effects: reads no env vars, files, or credential stores.
 * Contrast with {@link ./credential-materializer.ts}, which reads the actual secrets.
 */
import { type RuntimeName } from "@grackle-ai/common";
import { type CredentialProviderConfig } from "@grackle-ai/database";

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

/**
 * The primary credential provider each runtime requires to function. Only
 * includes runtimes that need a credential; credential-free runtimes (`stub`,
 * `genaiscript`) are absent.
 *
 * @internal Exported for catalog-coherence testing — verify that every key is
 * a {@link RUNTIME_CATALOG} entry and its value equals `RUNTIME_PROVIDERS[runtime][0]`.
 */
export const RUNTIME_REQUIRED_PROVIDER: Readonly<
  Partial<Record<string, keyof CredentialProviderConfig>>
> = {
  "claude-code": "claude",
  copilot: "copilot",
  codex: "codex",
  goose: "goose",
  "claude-code-acp": "claude",
  "codex-acp": "codex",
  "copilot-acp": "copilot",
};

/**
 * Return the primary credential provider key when it is disabled for a
 * credential-requiring runtime, or `undefined` when the runtime is either
 * credential-free or its primary provider is already enabled.
 *
 * This detects the misconfiguration where a runtime that needs credentials
 * has its primary provider left at the default `"off"` value — the normal
 * {@link deriveCredentialNeeds} / {@link findUnsatisfiedNeeds} path cannot
 * catch this because disabled providers produce no needs to validate.
 *
 * **Pure**: reads no env vars, files, or credential store.
 */
export function findDisabledRequiredProvider(
  runtime: string,
  config: CredentialProviderConfig,
): keyof CredentialProviderConfig | undefined {
  const required = RUNTIME_REQUIRED_PROVIDER[runtime];
  if (required === undefined) {
    return undefined;
  }
  const value = config[required];
  return value === "off" ? required : undefined;
}
