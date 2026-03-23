import db from "./db.js";
import { personas, type PersonaRow } from "./schema.js";
import { eq, asc, sql } from "drizzle-orm";

export type { PersonaRow };

/** Insert a new persona record. */
export function createPersona(
  id: string,
  name: string,
  description: string,
  systemPrompt: string,
  toolConfig: string,
  runtime: string,
  model: string,
  maxTurns: number,
  mcpServers: string,
  type: string = "agent",
  script: string = "",
): void {
  db.insert(personas)
    .values({
      id,
      name,
      description,
      systemPrompt,
      toolConfig,
      runtime,
      model,
      maxTurns,
      mcpServers,
      type,
      script,
    })
    .run();
}

/** Retrieve a single persona by ID. */
export function getPersona(id: string): PersonaRow | undefined {
  return db.select().from(personas).where(eq(personas.id, id)).get();
}

/** Retrieve a persona by name. */
export function getPersonaByName(name: string): PersonaRow | undefined {
  return db.select().from(personas).where(eq(personas.name, name)).get();
}

/** Return all personas, ordered by name. */
export function listPersonas(): PersonaRow[] {
  return db.select().from(personas).orderBy(asc(personas.name)).all();
}

/** Update an existing persona. */
export function updatePersona(
  id: string,
  name: string,
  description: string,
  systemPrompt: string,
  toolConfig: string,
  runtime: string,
  model: string,
  maxTurns: number,
  mcpServers: string,
  type: string = "agent",
  script: string = "",
): void {
  db.update(personas)
    .set({
      name,
      description,
      systemPrompt,
      toolConfig,
      runtime,
      model,
      maxTurns,
      mcpServers,
      type,
      script,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(personas.id, id))
    .run();
}

/** Delete a persona by ID. */
export function deletePersona(id: string): void {
  db.delete(personas).where(eq(personas.id, id)).run();
}
