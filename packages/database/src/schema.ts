import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── Environments ──────────────────────────────────────────

/* eslint-disable @rushstack/typedef-var -- Drizzle table types are inferred from sqliteTable() */
export const environments = sqliteTable("environments", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  adapterType: text("adapter_type").notNull(),
  adapterConfig: text("adapter_config").notNull(),
  defaultRuntime: text("default_runtime").notNull().default("claude-code"),
  bootstrapped: integer("bootstrapped", { mode: "boolean" })
    .notNull()
    .default(false),
  status: text("status").notNull().default("disconnected"),
  lastSeen: text("last_seen"),
  envInfo: text("env_info"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  powerlineToken: text("powerline_token").notNull().default(""),
});

/** Row shape returned by a SELECT on the environments table. */
export type EnvironmentRow = typeof environments.$inferSelect;

/** Shape accepted by INSERT into the environments table. */
export type NewEnvironment = typeof environments.$inferInsert;

// ─── Sessions ──────────────────────────────────────────────

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  environmentId: text("env_id")
    .notNull()
    .references(() => environments.id),
  runtime: text("runtime").notNull(),
  runtimeSessionId: text("runtime_session_id"),
  prompt: text("prompt").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("pending"),
  logPath: text("log_path"),
  turns: integer("turns").notNull().default(0),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  suspendedAt: text("suspended_at"),
  endedAt: text("ended_at"),
  endReason: text("end_reason"),
  error: text("error"),
  taskId: text("task_id").notNull().default(""),
  personaId: text("persona_id").notNull().default(""),
  parentSessionId: text("parent_session_id").notNull().default(""),
  pipeMode: text("pipe_mode").notNull().default(""),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
});

/** Row shape returned by a SELECT on the sessions table. */
export type SessionRow = typeof sessions.$inferSelect;

/** Shape accepted by INSERT into the sessions table. */
export type NewSession = typeof sessions.$inferInsert;

// ─── Tokens ────────────────────────────────────────────────

export const tokens = sqliteTable("tokens", {
  id: text("id").primaryKey(),
  config: text("config").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/** Row shape returned by a SELECT on the tokens table. */
export type TokenRow = typeof tokens.$inferSelect;

// ─── Workspaces ───────────────────────────────────────────

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  repoUrl: text("repo_url").notNull().default(""),
  environmentId: text("environment_id").notNull().references(() => environments.id),
  status: text("status").notNull().default("active"),
  useWorktrees: integer("use_worktrees", { mode: "boolean" })
    .notNull()
    .default(true),
  workingDirectory: text("working_directory").notNull().default(""),
  defaultPersonaId: text("default_persona_id").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/** Row shape returned by a SELECT on the workspaces table. */
export type WorkspaceRow = typeof workspaces.$inferSelect;

/** Shape accepted by INSERT into the workspaces table. */
export type NewWorkspace = typeof workspaces.$inferInsert;

// ─── Tasks ────────────────────────────────────────────────

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .references(() => workspaces.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("not_started"),
  branch: text("branch").notNull().default(""),
  dependsOn: text("depends_on").notNull().default("[]"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  sortOrder: integer("sort_order").notNull().default(0),
  parentTaskId: text("parent_task_id").notNull().default(""),
  depth: integer("depth").notNull().default(0),
  canDecompose: integer("can_decompose", { mode: "boolean" })
    .notNull()
    .default(false),
  defaultPersonaId: text("default_persona_id").notNull().default(""),
});

/** Row shape returned by a SELECT on the tasks table. */
export type TaskRow = typeof tasks.$inferSelect;

/** Shape accepted by INSERT into the tasks table. */
export type NewTask = typeof tasks.$inferInsert;

// ─── Findings ─────────────────────────────────────────────

export const findings = sqliteTable("findings", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  taskId: text("task_id").notNull().default(""),
  sessionId: text("session_id").notNull().default(""),
  category: text("category").notNull().default("general"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags").notNull().default("[]"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/** Row shape returned by a SELECT on the findings table. */
export type FindingRow = typeof findings.$inferSelect;

/** Shape accepted by INSERT into the findings table. */
export type NewFinding = typeof findings.$inferInsert;

// ─── Settings ─────────────────────────────────────────────

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Row shape returned by a SELECT on the settings table. */
export type SettingRow = typeof settings.$inferSelect;

// ─── Personas ─────────────────────────────────────────────

export const personas = sqliteTable("personas", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  systemPrompt: text("system_prompt").notNull(),
  toolConfig: text("tool_config").notNull().default("{}"),
  runtime: text("runtime").notNull().default(""),
  model: text("model").notNull().default(""),
  maxTurns: integer("max_turns").notNull().default(0),
  mcpServers: text("mcp_servers").notNull().default("[]"),
  type: text("type").notNull().default("agent"),
  script: text("script").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/** Row shape returned by a SELECT on the personas table. */
export type PersonaRow = typeof personas.$inferSelect;

/** Shape accepted by INSERT into the personas table. */
export type NewPersona = typeof personas.$inferInsert;

// ─── Domain Events ───────────────────────────────────────

export const domainEvents = sqliteTable("domain_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  timestamp: text("timestamp").notNull(),
  payload: text("payload").notNull(),
});

/** Row shape returned by a SELECT on the domain_events table. */
export type DomainEventRow = typeof domainEvents.$inferSelect;
