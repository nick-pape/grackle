import db from "./db.js";
import { widgets, type WidgetRow } from "./schema.js";
import { eq, and, desc, sql } from "drizzle-orm";

export type { WidgetRow };

/**
 * Maximum stored widget body length (characters). Agent-authored bodies are
 * persisted verbatim; this guards the registry against unbounded DB growth and
 * pathological payloads. Mirrors the size discipline used elsewhere in the
 * store layer.
 */
export const MAX_WIDGET_BODY_CHARS: number = 256 * 1024;

/** Fields accepted when registering a new widget. */
export interface RegisterWidgetFields {
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

/** Fields accepted when updating an existing widget (all optional; version is always bumped). */
export interface UpdateWidgetFields {
  name?: string;
  description?: string;
  body?: string;
  propsSchema?: string;
}

/** Throw if a body exceeds the persisted size cap. */
function assertBodyWithinCap(body: string): void {
  if (body.length > MAX_WIDGET_BODY_CHARS) {
    throw new Error(`Widget body exceeds ${MAX_WIDGET_BODY_CHARS} characters`);
  }
}

/** Insert a new widget definition. */
export function registerWidget(fields: RegisterWidgetFields): void {
  assertBodyWithinCap(fields.body);
  db.insert(widgets).values({
    id: fields.id,
    workspaceId: fields.workspaceId,
    name: fields.name,
    description: fields.description ?? "",
    rendererKind: fields.rendererKind ?? "mcp-app-html",
    body: fields.body,
    propsSchema: fields.propsSchema ?? "",
    ownerTaskId: fields.ownerTaskId ?? "",
    ownerSessionId: fields.ownerSessionId ?? "",
  }).run();
}

/**
 * Update an existing widget's mutable fields, bumping `version` and `updated_at`.
 * Returns `true` when a row was updated, `false` when no widget has that id.
 */
export function updateWidget(id: string, fields: UpdateWidgetFields): boolean {
  if (fields.body !== undefined) {
    assertBodyWithinCap(fields.body);
  }
  const updates: Record<string, unknown> = {
    version: sql`${widgets.version} + 1`,
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
  const result = db.update(widgets).set(updates).where(eq(widgets.id, id)).run();
  return result.changes > 0;
}

/** Retrieve a single widget by id. */
export function getWidget(id: string): WidgetRow | undefined {
  return db.select().from(widgets).where(eq(widgets.id, id)).get();
}

/** Retrieve a widget by name within a workspace (most recent wins on duplicate names). */
export function findWidgetByName(workspaceId: string, name: string): WidgetRow | undefined {
  return db.select().from(widgets)
    .where(and(eq(widgets.workspaceId, workspaceId), eq(widgets.name, name)))
    .orderBy(desc(widgets.createdAt))
    .get();
}

/** List all widgets registered in a workspace, most recently updated first. */
export function listWidgets(workspaceId: string): WidgetRow[] {
  return db.select().from(widgets)
    .where(eq(widgets.workspaceId, workspaceId))
    .orderBy(desc(widgets.updatedAt))
    .all();
}

/** Delete a widget by id. Returns `true` when a row was removed. */
export function deleteWidget(id: string): boolean {
  const result = db.delete(widgets).where(eq(widgets.id, id)).run();
  return result.changes > 0;
}
