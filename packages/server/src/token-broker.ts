import { eq } from "drizzle-orm";
import db from "./db.js";
import { tokens, type TokenRow } from "./schema.js";
import { encrypt, decrypt } from "./crypto.js";
import { create } from "@bufbuild/protobuf";
import { powerline } from "@grackle-ai/common";
import * as adapterManager from "./adapter-manager.js";
import * as envRegistry from "./env-registry.js";
import { logger } from "./logger.js";
import { buildProviderTokenBundle } from "./credential-providers.js";

interface TokenConfig {
  name: string;
  type: string;
  envVar?: string;
  filePath?: string;
  value: string;
  expiresAt?: string;
}

/** Encrypt and store a token, then auto-push to all connected environments. */
export async function setToken(entry: TokenConfig): Promise<void> {
  const encrypted: TokenConfig = {
    ...entry,
    value: encrypt(entry.value),
  };
  db.insert(tokens)
    .values({ id: entry.name, config: JSON.stringify(encrypted) })
    .onConflictDoUpdate({
      target: tokens.id,
      set: { config: JSON.stringify(encrypted) },
    })
    .run();

  // Auto-push to all connected environments
  await pushToAll();
}

/** Delete a token by name and re-push the updated bundle to all environments. */
export async function deleteToken(name: string): Promise<void> {
  db.delete(tokens).where(eq(tokens.id, name)).run();
  await pushToAll();
}

/** List all stored tokens (values are omitted for security). */
export function listTokens(): Array<{ name: string; type: string; envVar?: string; filePath?: string; expiresAt?: string }> {
  const rows = db.select().from(tokens).all();
  return rows.map((row: TokenRow) => {
    const cfg = JSON.parse(row.config) as TokenConfig;
    return {
      name: cfg.name,
      type: cfg.type,
      envVar: cfg.envVar,
      filePath: cfg.filePath,
      expiresAt: cfg.expiresAt,
    };
  });
}

/** Build a decrypted token bundle suitable for pushing to a PowerLine. */
export function getBundle(): powerline.TokenBundle {
  const rows = db.select().from(tokens).all();
  const items = rows.map((row: TokenRow) => {
    const cfg = JSON.parse(row.config) as TokenConfig;
    return create(powerline.TokenItemSchema, {
      name: cfg.name,
      type: cfg.type,
      envVar: cfg.envVar || "",
      filePath: cfg.filePath || "",
      value: decrypt(cfg.value),
    });
  });

  return create(powerline.TokenBundleSchema, { tokens: items });
}

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
