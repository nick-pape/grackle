import db from "./db.js";
import { tokens, type TokenRow } from "./schema.js";
import { encrypt, decrypt } from "./crypto.js";
import { create } from "@bufbuild/protobuf";
import { powerline } from "@grackle/common";
import * as adapterManager from "./adapter-manager.js";
import { logger } from "./logger.js";

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

/** Push the current token bundle to a single connected environment. */
export async function pushToEnv(environmentId: string): Promise<void> {
  const conn = adapterManager.getConnection(environmentId);
  if (!conn) {
    return;
  }

  const bundle = getBundle();
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
    promises.push(pushToEnv(environmentId).catch((err) => {
      logger.error({ environmentId, err }, "Failed to push tokens");
    }));
  }

  await Promise.all(promises);
}
