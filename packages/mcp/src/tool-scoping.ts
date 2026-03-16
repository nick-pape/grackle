import type { AuthContext } from "./auth-context.js";
import type { ToolRegistry, ToolDefinition } from "./tool-registry.js";

/** Tools exposed to scoped-token (agent) callers. */
export const SCOPED_TOOLS: ReadonlySet<string> = new Set([
  "finding_post", "finding_list", "task_create",
]);

/** Old tool names aliased to canonical registry names for backward compatibility. */
export const TOOL_ALIASES: ReadonlyMap<string, string> = new Map([
  ["post_finding", "finding_post"],
  ["query_findings", "finding_list"],
]);

/** Resolve a tool by name, handling aliases and scope checks. */
export function resolveToolForAuth(
  registry: ToolRegistry,
  name: string,
  authContext: AuthContext,
): ToolDefinition | undefined {
  const resolved = registry.get(name) ?? registry.get(TOOL_ALIASES.get(name) ?? "");
  if (!resolved) {
    return undefined;
  }
  if (authContext.type === "scoped" && !SCOPED_TOOLS.has(resolved.name)) {
    return undefined;
  }
  return resolved;
}

/** List tools visible to the given auth context, including aliases for scoped tokens. */
export function listToolsForAuth(registry: ToolRegistry, authContext: AuthContext): ToolDefinition[] {
  if (authContext.type === "api-key") {
    return registry.list();
  }
  const tools = registry.list((t) => SCOPED_TOOLS.has(t.name));
  const aliasEntries: ToolDefinition[] = [];
  for (const [alias, canonical] of TOOL_ALIASES) {
    const tool = registry.get(canonical);
    if (tool && SCOPED_TOOLS.has(canonical)) {
      aliasEntries.push({ ...tool, name: alias });
    }
  }
  return [...tools, ...aliasEntries];
}
