import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
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
  maxConcurrentSessions: integer("max_concurrent_sessions").notNull().default(0),
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
  costMillicents: integer("cost_millicents").notNull().default(0),
  sigtermSentAt: text("sigterm_sent_at"),
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
  status: text("status").notNull().default("active"),
  useWorktrees: integer("use_worktrees", { mode: "boolean" })
    .notNull()
    .default(true),
  workingDirectory: text("working_directory").notNull().default(""),
  defaultPersonaId: text("default_persona_id").notNull().default(""),
  tokenBudget: integer("token_budget").notNull().default(0),
  costBudgetMillicents: integer("cost_budget_millicents").notNull().default(0),
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

// ─── Workspace–Environment Links ─────────────────────────

export const workspaceEnvironmentLinks = sqliteTable("workspace_environment_links", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  environmentId: text("environment_id").notNull().references(() => environments.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.environmentId] }),
]);

/** Row shape returned by a SELECT on the workspace_environment_links table. */
export type WorkspaceEnvironmentLinkRow = typeof workspaceEnvironmentLinks.$inferSelect;

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
  workpad: text("workpad").notNull().default(""),
  scheduleId: text("schedule_id").notNull().default(""),
  tokenBudget: integer("token_budget").notNull().default(0),
  costBudgetMillicents: integer("cost_budget_millicents").notNull().default(0),
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
  allowedMcpTools: text("allowed_mcp_tools").notNull().default("[]"),
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

// ─── Schedules ───────────────────────────────────────────

export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  scheduleExpression: text("schedule_expression").notNull(),
  personaId: text("persona_id").notNull(),
  workspaceId: text("workspace_id").notNull().default(""),
  parentTaskId: text("parent_task_id").notNull().default(""),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: text("last_run_at"),
  nextRunAt: text("next_run_at"),
  runCount: integer("run_count").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/** Row shape returned by a SELECT on the schedules table. */
export type ScheduleRow = typeof schedules.$inferSelect;

/** Shape accepted by INSERT into the schedules table. */
export type NewSchedule = typeof schedules.$inferInsert;

// ─── Escalations ─────────────────────────────────────────

export const escalations = sqliteTable("escalations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default(""),
  taskId: text("task_id").notNull().default(""),
  title: text("title").notNull(),
  message: text("message").notNull().default(""),
  source: text("source").notNull().default("explicit"),
  urgency: text("urgency").notNull().default("normal"),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  deliveredAt: text("delivered_at"),
  acknowledgedAt: text("acknowledged_at"),
  taskUrl: text("task_url").notNull().default(""),
});

/** Row shape returned by a SELECT on the escalations table. */
export type EscalationRow = typeof escalations.$inferSelect;

/** Shape accepted by INSERT into the escalations table. */
export type NewEscalation = typeof escalations.$inferInsert;

// ─── Dispatch Queue ──────────────────────────────────────

export const dispatchQueue = sqliteTable("dispatch_queue", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().unique(),
  environmentId: text("environment_id").notNull().default(""),
  personaId: text("persona_id").notNull().default(""),
  notes: text("notes").notNull().default(""),
  pipe: text("pipe").notNull().default(""),
  parentSessionId: text("parent_session_id").notNull().default(""),
  enqueuedAt: text("enqueued_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

/** Row shape returned by a SELECT on the dispatch_queue table. */
export type DispatchQueueRow = typeof dispatchQueue.$inferSelect;

/** Shape accepted by INSERT into the dispatch_queue table. */
export type NewDispatchQueueRow = typeof dispatchQueue.$inferInsert;

// ─── Domain Events ───────────────────────────────────────

export const domainEvents = sqliteTable("domain_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  timestamp: text("timestamp").notNull(),
  payload: text("payload").notNull(),
});

/** Row shape returned by a SELECT on the domain_events table. */
export type DomainEventRow = typeof domainEvents.$inferSelect;

// ─── Plugins ─────────────────────────────────────────────────

export const plugins = sqliteTable("plugins", {
  name: text("name").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/** Row shape returned by a SELECT on the plugins table. */
export type PluginRow = typeof plugins.$inferSelect;
