/**
 * MCP tool preset constants for persona-scoped tool filtering.
 *
 * These constants define which MCP tools are available to task agents
 * based on their persona configuration. The tool names must match the
 * names registered in the MCP tool registry (`packages/mcp/src/tools/`).
 */

// ─── Complete Tool Registry ──────────────────────────────────

/** Every MCP tool name registered in the Grackle MCP server. */
export const ALL_MCP_TOOL_NAMES: ReadonlySet<string> = new Set([
  // config
  "config_get_default_persona", "config_set_default_persona",
  // credential
  "credential_provider_list", "credential_provider_set",
  // env
  "env_list", "env_add", "env_provision", "env_stop", "env_destroy", "env_remove", "env_wake",
  // finding
  "finding_list", "finding_post",
  // ipc
  "ipc_spawn", "ipc_write", "ipc_close", "ipc_list_fds", "ipc_terminate", "ipc_create_stream", "ipc_attach",
  // knowledge
  "knowledge_search", "knowledge_get_node", "knowledge_create_node",
  // logs
  "logs_get",
  // persona
  "persona_list", "persona_create", "persona_show", "persona_edit", "persona_delete",
  // session
  "session_spawn", "session_resume", "session_status", "session_kill", "session_attach", "session_send_input",
  // task
  "task_list", "task_create", "task_show", "task_update", "task_start", "task_delete", "task_complete", "task_resume",
  // token
  "token_list", "token_set", "token_delete",
  // usage
  "usage_get",
  // version
  "get_version_status",
  // schedule
  "schedule_list", "schedule_create", "schedule_show", "schedule_update", "schedule_delete",
  // workpad
  "workpad_write", "workpad_read",
  // workspace
  "workspace_list", "workspace_create", "workspace_get", "workspace_update", "workspace_archive",
  // escalation
  "escalate_to_human", "escalation_list", "escalation_acknowledge",
]);

// ─── Preset Tool Sets ────────────────────────────────────────

/**
 * Default scoped tools — the baseline set exposed to task agents when
 * the persona has no explicit `allowed_mcp_tools` configuration.
 * Matches the current hardcoded `SCOPED_TOOLS` set in tool-scoping.ts.
 */
export const DEFAULT_SCOPED_MCP_TOOLS: readonly string[] = [
  "finding_post", "finding_list",
  "task_create", "task_list", "task_show", "task_start", "task_complete",
  "session_attach", "session_send_input",
  "persona_list", "persona_show",
  "ipc_spawn", "ipc_write", "ipc_close", "ipc_terminate", "ipc_list_fds",
  "ipc_create_stream", "ipc_attach",
  "knowledge_search", "knowledge_get_node",
  "logs_get",
  "workpad_write", "workpad_read",
  "schedule_list", "schedule_show",
] as const;

/**
 * Worker preset — tools for leaf-task execution without subtask creation.
 * A strict subset of DEFAULT_SCOPED_MCP_TOOLS.
 */
export const WORKER_MCP_TOOLS: readonly string[] = [
  "finding_post", "finding_list",
  "task_show",
  "session_attach", "session_send_input",
  "persona_list", "persona_show",
  "ipc_spawn", "ipc_write", "ipc_close", "ipc_terminate", "ipc_list_fds",
  "ipc_create_stream", "ipc_attach",
  "knowledge_search", "knowledge_get_node",
  "logs_get",
  "workpad_write", "workpad_read",
] as const;

/**
 * Orchestrator preset — all default tools plus management tools for
 * planning, delegating, and coordinating work across subtasks.
 */
export const ORCHESTRATOR_MCP_TOOLS: readonly string[] = [
  // All default scoped tools
  "finding_post", "finding_list",
  "task_create", "task_list", "task_show", "task_start", "task_complete",
  "session_attach", "session_send_input",
  "persona_list", "persona_show",
  "ipc_spawn", "ipc_write", "ipc_close", "ipc_terminate", "ipc_list_fds",
  "ipc_create_stream", "ipc_attach",
  "knowledge_search", "knowledge_get_node",
  "logs_get",
  "workpad_write", "workpad_read",
  "schedule_list", "schedule_show",
  // Additional management tools
  "task_update", "task_delete", "task_resume",
  "session_spawn", "session_kill", "session_status",
  "persona_create",
  "knowledge_create_node",
  "schedule_create", "schedule_update", "schedule_delete",
  // Escalation — orchestrators can page the human
  "escalate_to_human",
] as const;

/**
 * Admin preset — full access to all MCP tools.
 * Stored as the explicit list of all registered tools (no empty-array ambiguity).
 */
export const ADMIN_MCP_TOOLS: readonly string[] = [...ALL_MCP_TOOL_NAMES] as const;

// ─── Preset Map ──────────────────────────────────────────────

/** Map of preset name to tool list, for CLI and web UI. */
export const MCP_TOOL_PRESETS: Readonly<Record<string, readonly string[]>> = {
  default: DEFAULT_SCOPED_MCP_TOOLS,
  worker: WORKER_MCP_TOOLS,
  orchestrator: ORCHESTRATOR_MCP_TOOLS,
  admin: ADMIN_MCP_TOOLS,
} as const;
