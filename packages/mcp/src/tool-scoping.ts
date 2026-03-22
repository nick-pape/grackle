import type { AuthContext } from "./auth-context.js";
import type { ToolRegistry, ToolDefinition } from "./tool-registry.js";

/** Tools exposed to scoped-token (agent) callers. */
export const SCOPED_TOOLS: ReadonlySet<string> = new Set([
  "finding_post", "finding_list",
  "task_create", "task_list", "task_show", "task_start", "task_complete",
  "session_send_input",
  "persona_list", "persona_show",
  "ipc_spawn", "ipc_write", "ipc_close", "ipc_list_fds",
  "knowledge_search", "knowledge_get_node",
]);

/** Auth types that receive full tool access. */
const FULL_ACCESS_TYPES: ReadonlySet<AuthContext["type"]> = new Set(["api-key", "oauth"]);

/** Resolve a tool by name with scope checks. */
export function resolveToolForAuth(
  registry: ToolRegistry,
  name: string,
  authContext: AuthContext,
): ToolDefinition | undefined {
  const tool = registry.get(name);
  if (!tool) {
    return undefined;
  }
  if (!FULL_ACCESS_TYPES.has(authContext.type) && !SCOPED_TOOLS.has(tool.name)) {
    return undefined;
  }
  return tool;
}

/** List tools visible to the given auth context. */
export function listToolsForAuth(registry: ToolRegistry, authContext: AuthContext): ToolDefinition[] {
  if (FULL_ACCESS_TYPES.has(authContext.type)) {
    return registry.list();
  }
  return registry.list((t) => SCOPED_TOOLS.has(t.name));
}
