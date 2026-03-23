/**
 * Pure persistence layer for encrypted token storage.
 * No network operations — see {@link ./token-push.ts} for push orchestration.
 */
import { eq } from "drizzle-orm";
import db from "./db.js";
import { tokens, type TokenRow } from "./schema.js";
import { encrypt, decrypt } from "./crypto.js";
import { create } from "@bufbuild/protobuf";
import { powerline } from "@grackle-ai/common";

/** Shape of a token's stored configuration. */
export interface TokenConfig {
  name: string;
  type: string;
  envVar?: string;
  filePath?: string;
  value: string;
  expiresAt?: string;
}

/** Encrypt and store (or update) a token. */
export function setToken(entry: TokenConfig): void {
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
}

/** Delete a token by name. */
export function deleteToken(name: string): void {
  db.delete(tokens).where(eq(tokens.id, name)).run();
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
