/**
 * On-demand credential supply (AHP HR6).
 *
 * Builds the combined credential bundle for a runtime (stored user tokens +
 * provider credentials read fresh from env/disk) and authenticates it to the
 * connected PowerLine just-in-time, immediately before a spawn. This replaces
 * the proactive `PushTokens` injection (eager push before every spawn / on
 * token change / on reconnect): credentials are now supplied on demand, scoped
 * to the runtime being spawned.
 *
 * Pure persistence lives in `@grackle-ai/database` (tokenStore); credential
 * bundle building lives in {@link ./credential-bundle.ts}.
 */
import { PreconditionError } from "@grackle-ai/common";
import { type AuthenticateTokenItem } from "@grackle-ai/adapter-sdk";
import * as adapterManager from "./adapter-manager.js";
import { getDatabaseStores } from "@grackle-ai/database";
import {
  buildProviderTokenBundle,
  deriveCredentialNeeds,
  findDisabledRequiredProvider,
  findUnsatisfiedNeeds,
  formatPreflightCredentialError,
  formatRuntimeProviderDisabledError,
} from "./credential-bundle.js";
import { logger } from "./logger.js";

/** Options for {@link authenticateForRuntime}. */
export interface AuthenticateOptions {
  /** When true, filter out file-type tokens (only supply env vars) — used for local envs. */
  excludeFileTokens?: boolean;
}

/**
 * Supply credentials for a runtime to its environment on demand, just before a
 * spawn. Combines stored user tokens with the runtime-scoped provider bundle
 * (read fresh from env/disk) and delivers them via the host transport's
 * `authenticate` method.
 *
 * **Fail-fast pre-flight (#1316):** before delivery, this validates that every
 * credential the runtime advertises a need for (a provider that is *enabled* in
 * the credential-provider config) is actually present — and, for OAuth-file
 * credentials, not expired-beyond-refresh. When a required credential is missing
 * or its login has expired with no refresh token, it throws a
 * `PreconditionError` with an actionable message rather than
 * letting the runtime fail with an opaque 401 mid-agent. (Providers that are
 * *off* are not validated.) Note this changes the function from never-throws to
 * fail-fast on a required-but-missing credential.
 *
 * Once the pre-flight gate passes, *delivery* remains best-effort: a transport
 * `authenticate` failure is logged and does not block the spawn.
 */
export async function authenticateForRuntime(
  environmentId: string,
  runtime: string,
  options?: AuthenticateOptions,
): Promise<void> {
  const { credentialProviders, envRegistry, tokenStore } = getDatabaseStores();
  const conn = adapterManager.getConnection(environmentId);
  if (!conn) {
    return;
  }

  const env = envRegistry.getEnvironment(environmentId);
  const githubAccountId = env?.githubAccountId || undefined;

  const stored = tokenStore.getBundle();
  const provider = await buildProviderTokenBundle(runtime, undefined, githubAccountId);

  const config = credentialProviders.getCredentialProviders();

  // Pre-flight: catch the case where the runtime's primary credential provider
  // is still at the default "off" value. deriveCredentialNeeds / findUnsatisfiedNeeds
  // cannot detect this because disabled providers produce no needs to validate,
  // meaning the gate below would silently pass and the SDK would throw an opaque
  // error from inside createSession(). Throw early with an actionable message.
  const disabledProvider = findDisabledRequiredProvider(runtime, config);
  if (disabledProvider !== undefined) {
    throw new PreconditionError(formatRuntimeProviderDisabledError(runtime, disabledProvider));
  }

  // Pre-flight credential validation (#1316). Validate the runtime's advertised
  // needs against the *unfiltered* provider bundle, so the local-env file-token
  // stripping below cannot mask a credential that is present on disk. Throws
  // before delivery (and before any session row is created at the call site).
  const unsatisfied = findUnsatisfiedNeeds(
    deriveCredentialNeeds(runtime, config),
    provider,
    Date.now(),
  );
  if (unsatisfied.length > 0) {
    throw new PreconditionError(formatPreflightCredentialError(runtime, unsatisfied));
  }

  // Provider credentials come last so they win over any same-target stored token.
  let combined = [...stored.tokens, ...provider.tokens];
  if (options?.excludeFileTokens) {
    combined = combined.filter((t) => t.type !== "file");
  }
  if (combined.length === 0) {
    return;
  }

  const tokens: AuthenticateTokenItem[] = combined.map((t) => ({
    name: t.name,
    type: t.type,
    envVar: t.envVar,
    filePath: t.filePath,
    value: t.value,
  }));

  try {
    await conn.transport.authenticate({ provider: runtime, tokens });
  } catch (err) {
    logger.warn({ environmentId, runtime, err }, "Failed to authenticate credentials before spawn");
  }
}
