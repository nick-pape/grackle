import type { AuthContext } from "./auth-context.js";
import type { ToolRegistry, ToolDefinition } from "./tool-registry.js";

/** Tools exposed to scoped-token (agent) callers. */
export const SCOPED_TOOLS: ReadonlySet<string> = new Set([
  "finding_post", "finding_list", "task_create",
]);

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
  if (authContext.type === "scoped" && !SCOPED_TOOLS.has(tool.name)) {
    return undefined;
  }
  return tool;
}

/** List tools visible to the given auth context. */
export function listToolsForAuth(registry: ToolRegistry, authContext: AuthContext): ToolDefinition[] {
  if (authContext.type === "api-key") {
    return registry.list();
  }
  return registry.list((t) => SCOPED_TOOLS.has(t.name));
}
