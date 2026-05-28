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
import { GrpcHostTransport, type AuthenticateTokenItem } from "@grackle-ai/adapter-sdk";
import * as adapterManager from "./adapter-manager.js";
import { envRegistry, tokenStore } from "@grackle-ai/database";
import { buildProviderTokenBundle } from "./credential-bundle.js";
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
 * `authenticate` method. Best-effort: failures are logged and do not block the
 * spawn.
 */
export async function authenticateForRuntime(
  environmentId: string,
  runtime: string,
  options?: AuthenticateOptions,
): Promise<void> {
  const conn = adapterManager.getConnection(environmentId);
  if (!conn) {
    return;
  }

  const env = envRegistry.getEnvironment(environmentId);
  const githubAccountId = env?.githubAccountId || undefined;

  const stored = tokenStore.getBundle();
  const provider = await buildProviderTokenBundle(runtime, undefined, githubAccountId);
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
    const transport = new GrpcHostTransport(conn.client);
    await transport.authenticate({ provider: runtime, tokens });
  } catch (err) {
    logger.warn({ environmentId, runtime, err }, "Failed to authenticate credentials before spawn");
  }
}
