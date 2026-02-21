import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── Environments ──────────────────────────────────────────

export const environments = sqliteTable("environments", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  adapterType: text("adapter_type").notNull(),
  adapterConfig: text("adapter_config").notNull(),
  defaultRuntime: text("default_runtime").notNull().default("claude-code"),
  bootstrapped: integer("bootstrapped", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("disconnected"),
  lastSeen: text("last_seen"),
  envInfo: text("env_info"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  powerlineToken: text("powerline_token").notNull().default(""),
});

/** Row shape returned by a SELECT on the environments table. */
export type EnvironmentRow = typeof environments.$inferSelect;

/** Shape accepted by INSERT into the environments table. */
export type NewEnvironment = typeof environments.$inferInsert;

// ─── Sessions ──────────────────────────────────────────────

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  envId: text("env_id").notNull().references(() => environments.id),
  runtime: text("runtime").notNull(),
  runtimeSessionId: text("runtime_session_id"),
  prompt: text("prompt").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("pending"),
  logPath: text("log_path"),
  turns: integer("turns").notNull().default(0),
  startedAt: text("started_at").notNull().default(sql`(datetime('now'))`),
  suspendedAt: text("suspended_at"),
  endedAt: text("ended_at"),
  error: text("error"),
});

/** Row shape returned by a SELECT on the sessions table. */
export type SessionRow = typeof sessions.$inferSelect;

/** Shape accepted by INSERT into the sessions table. */
export type NewSession = typeof sessions.$inferInsert;

// ─── Tokens ────────────────────────────────────────────────

export const tokens = sqliteTable("tokens", {
  id: text("id").primaryKey(),
  config: text("config").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

/** Row shape returned by a SELECT on the tokens table. */
export type TokenRow = typeof tokens.$inferSelect;
