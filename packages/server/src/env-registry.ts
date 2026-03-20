import db from "./db.js";
import { environments, type EnvironmentRow } from "./schema.js";
import { eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { EnvironmentStatus } from "@grackle-ai/common";

const POWERLINE_TOKEN_BYTE_LENGTH: number = 32;

export type { EnvironmentRow };

/** Return all registered environments. */
export function listEnvironments(): EnvironmentRow[] {
  return db.select().from(environments).all();
}

/** Retrieve a single environment by ID. */
export function getEnvironment(id: string): EnvironmentRow | undefined {
  return db.select().from(environments).where(eq(environments.id, id)).get();
}

/** Insert a new environment record with a randomly-generated PowerLine token. */
export function addEnvironment(
  id: string,
  displayName: string,
  adapterType: string,
  adapterConfig: string,
): void {
  const powerlineToken = randomBytes(POWERLINE_TOKEN_BYTE_LENGTH).toString("hex");
  db.insert(environments).values({
    id,
    displayName,
    adapterType,
    adapterConfig,
    powerlineToken,
  }).run();
}

/** Delete an environment record from the database. */
export function removeEnvironment(id: string): void {
  db.delete(environments).where(eq(environments.id, id)).run();
}

/** Update an environment's connection status and touch `last_seen`. */
export function updateEnvironmentStatus(id: string, status: EnvironmentStatus): void {
  db.update(environments)
    .set({ status, lastSeen: sql`datetime('now')` })
    .where(eq(environments.id, id))
    .run();
}

/** Mark an environment as having completed first-time bootstrap. */
export function markBootstrapped(id: string): void {
  db.update(environments)
    .set({ bootstrapped: true })
    .where(eq(environments.id, id))
    .run();
}

/** Store serialized environment info (e.g. OS, node version) from the PowerLine. */
export function setEnvInfo(id: string, info: string): void {
  db.update(environments)
    .set({ envInfo: info })
    .where(eq(environments.id, id))
    .run();
}

/** Update the adapter config JSON for an existing environment. */
export function updateAdapterConfig(id: string, config: string): void {
  db.update(environments)
    .set({ adapterConfig: config })
    .where(eq(environments.id, id))
    .run();
}

/** Updatable fields for an existing environment. */
export interface UpdateEnvironmentFields {
  displayName?: string;
  adapterConfig?: string;
}

/** Update mutable fields (displayName, adapterConfig) of an existing environment. */
export function updateEnvironment(id: string, fields: UpdateEnvironmentFields): void {
  const updates: Record<string, unknown> = {};
  if (fields.displayName !== undefined) {
    updates.displayName = fields.displayName;
  }
  if (fields.adapterConfig !== undefined) {
    updates.adapterConfig = fields.adapterConfig;
  }
  if (Object.keys(updates).length === 0) {
    return;
  }
  db.update(environments)
    .set(updates)
    .where(eq(environments.id, id))
    .run();
}

/** Reset all environment statuses to disconnected on server startup. */
export function resetAllStatuses(): void {
  db.update(environments).set({ status: "disconnected" }).run();
}
