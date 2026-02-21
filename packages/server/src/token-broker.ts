import db from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import { create } from "@bufbuild/protobuf";
import { sidecar } from "@grackle/common";
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

const stmts = {
  upsert: db.prepare("INSERT OR REPLACE INTO tokens (id, config) VALUES (?, ?)"),
  get: db.prepare("SELECT * FROM tokens WHERE id = ?"),
  list: db.prepare("SELECT * FROM tokens"),
  remove: db.prepare("DELETE FROM tokens WHERE id = ?"),
};

/** Encrypt and store a token, then auto-push to all connected environments. */
export async function setToken(entry: TokenConfig): Promise<void> {
  const encrypted: TokenConfig = {
    ...entry,
    value: encrypt(entry.value),
  };
  stmts.upsert.run(entry.name, JSON.stringify(encrypted));

  // Auto-push to all connected environments
  await pushToAll();
}

/** List all stored tokens (values are omitted for security). */
export function listTokens(): Array<{ name: string; type: string; envVar?: string; filePath?: string; expiresAt?: string }> {
  const rows = stmts.list.all() as Array<{ id: string; config: string }>;
  return rows.map((row) => {
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

/** Build a decrypted token bundle suitable for pushing to a sidecar. */
export function getBundle(): sidecar.TokenBundle {
  const rows = stmts.list.all() as Array<{ id: string; config: string }>;
  const tokens = rows.map((row) => {
    const cfg = JSON.parse(row.config) as TokenConfig;
    return create(sidecar.TokenItemSchema, {
      name: cfg.name,
      type: cfg.type,
      envVar: cfg.envVar || "",
      filePath: cfg.filePath || "",
      value: decrypt(cfg.value),
    });
  });

  return create(sidecar.TokenBundleSchema, { tokens });
}

/** Push the current token bundle to a single connected environment. */
export async function pushToEnv(envId: string): Promise<void> {
  const conn = adapterManager.getConnection(envId);
  if (!conn) return;

  const bundle = getBundle();
  if (bundle.tokens.length === 0) return;

  await conn.client.pushTokens(bundle);
}

/** Push the current token bundle to all connected environments in parallel. */
export async function pushToAll(): Promise<void> {
  const connections = adapterManager.listConnections();
  const promises: Promise<void>[] = [];

  for (const [envId] of connections) {
    promises.push(pushToEnv(envId).catch((err) => {
      logger.error({ envId, err }, "Failed to push tokens");
    }));
  }

  await Promise.all(promises);
}
