/**
 * Token push orchestration — distributes stored tokens and credential
 * provider bundles to connected PowerLine environments.
 *
 * This is service-level logic that depends on adapter-manager (network) and
 * env-registry (lookup). The pure persistence layer lives in
 * {@link ./token-store.ts}, and credential bundle building lives in
 * {@link ./credential-bundle.ts}.
 */
import * as adapterManager from "./adapter-manager.js";
import * as envRegistry from "./env-registry.js";
import { getBundle } from "./token-store.js";
import { buildProviderTokenBundle } from "./credential-bundle.js";
import { logger } from "./logger.js";

/** Options for {@link pushToEnv}. */
export interface PushToEnvOptions {
  /** When true, filter out file-type tokens (only push env vars). */
  excludeFileTokens?: boolean;
}

/** Push the current token bundle to a single connected environment. */
export async function pushToEnv(environmentId: string, options?: PushToEnvOptions): Promise<void> {
  const conn = adapterManager.getConnection(environmentId);
  if (!conn) {
    return;
  }

  const bundle = getBundle();

  if (options?.excludeFileTokens) {
    bundle.tokens = bundle.tokens.filter((t) => t.type !== "file");
  }

  if (bundle.tokens.length === 0) {
    return;
  }

  await conn.client.pushTokens(bundle);
}

/** Push the current token bundle to all connected environments in parallel. */
export async function pushToAll(): Promise<void> {
  const connections = adapterManager.listConnections();
  const promises: Promise<void>[] = [];

  for (const [environmentId] of connections) {
    const env = envRegistry.getEnvironment(environmentId);
    const opts: PushToEnvOptions | undefined =
      env?.adapterType === "local" ? { excludeFileTokens: true } : undefined;
    promises.push(pushToEnv(environmentId, opts).catch((err) => {
      logger.error({ environmentId, err }, "Failed to push tokens");
    }));
  }

  await Promise.all(promises);
}

/**
 * Push enabled provider credentials to a single connected environment.
 * When `runtime` is specified, only providers relevant to that runtime are included.
 * Reads fresh values from `process.env` / disk based on the credential provider config.
 */
export async function pushProviderCredentialsToEnv(environmentId: string, runtime?: string, options?: PushToEnvOptions): Promise<void> {
  const conn = adapterManager.getConnection(environmentId);
  if (!conn) {
    return;
  }

  const bundle = buildProviderTokenBundle(runtime);

  if (options?.excludeFileTokens) {
    bundle.tokens = bundle.tokens.filter((t) => t.type !== "file");
  }

  if (bundle.tokens.length === 0) {
    return;
  }

  await conn.client.pushTokens(bundle);
}

/**
 * Best-effort push of stored tokens and provider credentials before a task spawn.
 * When `runtime` is specified, only providers relevant to that runtime are pushed.
 * Both pushes run concurrently; failures are logged as warnings and do not block.
 */
export async function refreshTokensForTask(environmentId: string, runtime?: string, options?: PushToEnvOptions): Promise<void> {
  const results = await Promise.allSettled([
    pushToEnv(environmentId, options),
    pushProviderCredentialsToEnv(environmentId, runtime, options),
  ]);

  if (results[0].status === "rejected") {
    logger.warn({ environmentId, err: results[0].reason }, "Failed to push tokens before task start");
  }
  if (results[1].status === "rejected") {
    logger.warn({ environmentId, err: results[1].reason }, "Failed to push provider credentials before task start");
  }
}
