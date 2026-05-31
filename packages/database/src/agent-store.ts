import db from "./db.js";
import { agents, type AgentRow } from "./schema.js";
import { eq, asc, sql } from "drizzle-orm";

export type { AgentRow };

/** Insert a new agent record. */
export function createAgent(
  id: string,
  name: string,
  avatar: string,
  primaryPersonaId: string,
): void {
  db.insert(agents)
    .values({
      id,
      name,
      avatar,
      primaryPersonaId,
    })
    .run();
}

/** Retrieve a single agent by ID. */
export function getAgent(id: string): AgentRow | undefined {
  return db.select().from(agents).where(eq(agents.id, id)).get();
}

/** Retrieve an agent by name. */
export function getAgentByName(name: string): AgentRow | undefined {
  return db.select().from(agents).where(eq(agents.name, name)).get();
}

/** Return all agents, ordered by name. */
export function listAgents(): AgentRow[] {
  return db.select().from(agents).orderBy(asc(agents.name)).all();
}

/**
 * Update an existing agent. Only the provided fields are changed; pass
 * `undefined` to leave a field untouched.
 */
export function updateAgent(
  id: string,
  fields: { name?: string; avatar?: string; primaryPersonaId?: string },
): void {
  const updates: Record<string, unknown> = {
    updatedAt: sql`datetime('now')`,
  };
  if (fields.name !== undefined) {
    updates.name = fields.name;
  }
  if (fields.avatar !== undefined) {
    updates.avatar = fields.avatar;
  }
  if (fields.primaryPersonaId !== undefined) {
    updates.primaryPersonaId = fields.primaryPersonaId;
  }
  db.update(agents).set(updates).where(eq(agents.id, id)).run();
}

/** Delete an agent by ID. */
export function deleteAgent(id: string): void {
  db.delete(agents).where(eq(agents.id, id)).run();
}
