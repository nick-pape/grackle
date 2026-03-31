import db from "./db.js";
import { plugins } from "./schema.js";
import type { PluginRow } from "./schema.js";
import { eq, sql } from "drizzle-orm";

/** Retrieve whether a plugin is enabled. Returns `undefined` if no DB row exists. */
export function getPluginEnabled(name: string): boolean | undefined {
  const row = db.select().from(plugins).where(eq(plugins.name, name)).get();
  return row?.enabled;
}

/** Get a single plugin row. Returns `undefined` if no DB row exists. */
export function getPlugin(name: string): PluginRow | undefined {
  return db.select().from(plugins).where(eq(plugins.name, name)).get();
}

/** List all plugin rows. */
export function listPlugins(): PluginRow[] {
  return db.select().from(plugins).all();
}

/** Set a plugin's enabled state. Creates or overwrites the row and refreshes `updated_at`. */
export function setPluginEnabled(name: string, enabled: boolean): void {
  db.insert(plugins)
    .values({ name, enabled, updatedAt: sql`(datetime('now'))` })
    .onConflictDoUpdate({
      target: plugins.name,
      set: { enabled, updatedAt: sql`(datetime('now'))` },
    })
    .run();
}
