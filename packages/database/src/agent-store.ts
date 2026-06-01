import db from "./db.js";
import { agents, type AgentRow } from "./schema.js";
import { eq, asc, sql } from "drizzle-orm";

export type { AgentRow };

/**
 * Insert a new agent record.
 *
 * `environmentId` is required (the Agent's home environment, #1418).
 * Validation that the environment exists happens at the handler layer;
 * the store accepts any non-empty string.
 */
export function createAgent(
  id: string,
  name: string,
  avatar: string,
  primaryPersonaId: string,
  environmentId: string,
): void {
  db.insert(agents)
    .values({
      id,
      name,
      avatar,
      primaryPersonaId,
      environmentId,
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

/** Return all agents in a given environment, ordered by name. */
export function getAgentsByEnvironment(environmentId: string): AgentRow[] {
  return db
    .select()
    .from(agents)
    .where(eq(agents.environmentId, environmentId))
    .orderBy(asc(agents.name))
    .all();
}
