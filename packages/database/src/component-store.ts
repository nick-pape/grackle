import db from "./db.js";
import { components, type ComponentRow } from "./schema.js";
import { eq, and, desc, sql } from "drizzle-orm";

export type { ComponentRow };

/**
 * Maximum stored component body length (characters). Agent-authored bodies are
 * persisted verbatim; this guards the registry against unbounded DB growth and
 * pathological payloads. Mirrors the size discipline used elsewhere in the
 * store layer.
 */
export const MAX_COMPONENT_BODY_CHARS: number = 256 * 1024;

/** Fields accepted when registering a new component. */
export interface RegisterComponentFields {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  rendererKind?: string;
  body: string;
  propsSchema?: string;
  ownerTaskId?: string;
  ownerSessionId?: string;
}

/** Fields accepted when updating an existing component (all optional; version is always bumped). */
export interface UpdateComponentFields {
  name?: string;
  description?: string;
  body?: string;
  propsSchema?: string;
}

/** Throw if a body exceeds the persisted size cap. */
function assertBodyWithinCap(body: string): void {
  if (body.length > MAX_COMPONENT_BODY_CHARS) {
    throw new Error(`Component body exceeds ${MAX_COMPONENT_BODY_CHARS} characters`);
  }
}

/** Insert a new component definition. */
export function registerComponent(fields: RegisterComponentFields): void {
  assertBodyWithinCap(fields.body);
  db.insert(components).values({
    id: fields.id,
    workspaceId: fields.workspaceId,
    name: fields.name,
    description: fields.description ?? "",
    rendererKind: fields.rendererKind ?? "grackle-react",
    body: fields.body,
    propsSchema: fields.propsSchema ?? "",
    ownerTaskId: fields.ownerTaskId ?? "",
    ownerSessionId: fields.ownerSessionId ?? "",
  }).run();
}

/**
 * Update an existing component's mutable fields, bumping `version` and `updated_at`.
 * Returns `true` when a row was updated, `false` when no component has that id.
 */
export function updateComponent(id: string, fields: UpdateComponentFields): boolean {
  if (fields.body !== undefined) {
    assertBodyWithinCap(fields.body);
  }
  const updates: Record<string, unknown> = {
    version: sql`${components.version} + 1`,
    updatedAt: sql`(datetime('now'))`,
  };
  if (fields.name !== undefined) {
    updates.name = fields.name;
  }
  if (fields.description !== undefined) {
    updates.description = fields.description;
  }
  if (fields.body !== undefined) {
    updates.body = fields.body;
  }
  if (fields.propsSchema !== undefined) {
    updates.propsSchema = fields.propsSchema;
  }
  const result = db.update(components).set(updates).where(eq(components.id, id)).run();
  return result.changes > 0;
}

/** Retrieve a single component by id. */
export function getComponent(id: string): ComponentRow | undefined {
  return db.select().from(components).where(eq(components.id, id)).get();
}

/** Retrieve a component by name within a workspace (most recent wins on duplicate names). */
export function findComponentByName(workspaceId: string, name: string): ComponentRow | undefined {
  return db.select().from(components)
    .where(and(eq(components.workspaceId, workspaceId), eq(components.name, name)))
    .orderBy(desc(components.createdAt))
    .get();
}

/** List all components registered in a workspace, most recently updated first. */
export function listComponents(workspaceId: string): ComponentRow[] {
  return db.select().from(components)
    .where(eq(components.workspaceId, workspaceId))
    .orderBy(desc(components.updatedAt))
    .all();
}

/** Delete a component by id. Returns `true` when a row was removed. */
export function deleteComponent(id: string): boolean {
  const result = db.delete(components).where(eq(components.id, id)).run();
  return result.changes > 0;
}
