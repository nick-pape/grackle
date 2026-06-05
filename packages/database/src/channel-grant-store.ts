import db from "./db.js";
import { channelGrants, type ChannelGrantRow } from "./schema.js";
import { eq, desc } from "drizzle-orm";

export type { ChannelGrantRow };

/** Contract for channel grant persistence. */
export interface ChannelGrantStore {
  createGrant(
    id: string,
    channelUri: string,
    verbs: string,
    label: string,
    expiresAt: string | null,
  ): void;
  getGrant(id: string): ChannelGrantRow | undefined;
  listGrants(): ChannelGrantRow[];
  revokeGrant(id: string): void;
  deleteGrant(id: string): void;
}

/**
 * Persist a new channel grant.
 *
 * @param id - Grant ID (matches the token's `jti` claim)
 * @param channelUri - Channel the grant exposes, e.g. `grackle:/sessions/<id>`
 * @param verbs - Comma-separated permitted verbs (e.g. `send_input`)
 * @param label - Optional human-readable label for audit
 * @param expiresAt - ISO expiry timestamp, or null for the token's own default
 */
export function createGrant(
  id: string,
  channelUri: string,
  verbs: string,
  label: string,
  expiresAt: string | null,
): void {
  db.insert(channelGrants).values({ id, channelUri, verbs, label, expiresAt }).run();
}

/** Retrieve a grant by ID, or `undefined` if it does not exist. */
export function getGrant(id: string): ChannelGrantRow | undefined {
  return db.select().from(channelGrants).where(eq(channelGrants.id, id)).get();
}

/** List all channel grants, most recent first. */
export function listGrants(): ChannelGrantRow[] {
  return db.select().from(channelGrants).orderBy(desc(channelGrants.createdAt)).all();
}

/** Mark a grant as revoked. Idempotent. */
export function revokeGrant(id: string): void {
  db.update(channelGrants).set({ revoked: true }).where(eq(channelGrants.id, id)).run();
}

/** Delete a grant by ID. */
export function deleteGrant(id: string): void {
  db.delete(channelGrants).where(eq(channelGrants.id, id)).run();
}

const _typeCheck: ChannelGrantStore = {
  createGrant,
  getGrant,
  listGrants,
  revokeGrant,
  deleteGrant,
};
void _typeCheck;
