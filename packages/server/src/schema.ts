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

// ─── Projects ─────────────────────────────────────────────

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  repoUrl: text("repo_url").notNull().default(""),
  defaultEnvironmentId: text("default_env_id").notNull().default(""),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

/** Row shape returned by a SELECT on the projects table. */
export type ProjectRow = typeof projects.$inferSelect;

/** Shape accepted by INSERT into the projects table. */
export type NewProject = typeof projects.$inferInsert;

// ─── Tasks ────────────────────────────────────────────────

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("pending"),
  branch: text("branch").notNull().default(""),
  environmentId: text("env_id").notNull().default(""),
  sessionId: text("session_id").notNull().default(""),
  dependsOn: text("depends_on").notNull().default("[]"),
  assignedAt: text("assigned_at"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  reviewNotes: text("review_notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Row shape returned by a SELECT on the tasks table. */
export type TaskRow = typeof tasks.$inferSelect;

/** Shape accepted by INSERT into the tasks table. */
export type NewTask = typeof tasks.$inferInsert;

// ─── Findings ─────────────────────────────────────────────

export const findings = sqliteTable("findings", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  taskId: text("task_id").notNull().default(""),
  sessionId: text("session_id").notNull().default(""),
  category: text("category").notNull().default("general"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

/** Row shape returned by a SELECT on the findings table. */
export type FindingRow = typeof findings.$inferSelect;

/** Shape accepted by INSERT into the findings table. */
export type NewFinding = typeof findings.$inferInsert;
