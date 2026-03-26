import { ROOT_TASK_ID, DEFAULT_SCOPED_MCP_TOOLS } from "@grackle-ai/common";
import type { AuthContext } from "@grackle-ai/auth";
import type { ToolRegistry, ToolDefinition } from "./tool-registry.js";

/** Tools exposed to scoped-token (agent) callers when no persona override is set. */
export const SCOPED_TOOLS: ReadonlySet<string> = new Set(DEFAULT_SCOPED_MCP_TOOLS);

/** Auth types that receive full tool access. */
const FULL_ACCESS_TYPES: ReadonlySet<AuthContext["type"]> = new Set(["api-key", "oauth"]);

/** Whether the auth context has full (unrestricted) tool access. */
function hasFullAccess(authContext: AuthContext): boolean {
  if (FULL_ACCESS_TYPES.has(authContext.type)) {
    return true;
  }
  // The root/system task is the central orchestrator and needs full tool access.
  if (authContext.type === "scoped" && authContext.taskId === ROOT_TASK_ID) {
    return true;
  }
  return false;
}

/**
 * Resolve the effective tool allowlist for a scoped caller.
 * If personaAllowedTools is provided and non-empty, use it.
 * Otherwise fall back to the default SCOPED_TOOLS set.
 */
function effectiveAllowedTools(personaAllowedTools?: ReadonlySet<string>): ReadonlySet<string> {
  if (personaAllowedTools && personaAllowedTools.size > 0) {
    return personaAllowedTools;
  }
  return SCOPED_TOOLS;
}

/**
 * Resolve a tool by name with scope checks.
 *
 * @param personaAllowedTools - Optional persona-specific tool set. When provided
 *   and non-empty, overrides the default SCOPED_TOOLS for this scoped caller.
 */
export function resolveToolForAuth(
  registry: ToolRegistry,
  name: string,
  authContext: AuthContext,
  personaAllowedTools?: ReadonlySet<string>,
): ToolDefinition | undefined {
  const tool = registry.get(name);
  if (!tool) {
    return undefined;
  }
  if (!hasFullAccess(authContext) && !effectiveAllowedTools(personaAllowedTools).has(tool.name)) {
    return undefined;
  }
  return tool;
}

/**
 * List tools visible to the given auth context.
 *
 * @param personaAllowedTools - Optional persona-specific tool set. When provided
 *   and non-empty, overrides the default SCOPED_TOOLS for this scoped caller.
 */
export function listToolsForAuth(
  registry: ToolRegistry,
  authContext: AuthContext,
  personaAllowedTools?: ReadonlySet<string>,
): ToolDefinition[] {
  if (hasFullAccess(authContext)) {
    return registry.list();
  }
  const allowed = effectiveAllowedTools(personaAllowedTools);
  return registry.list((t) => allowed.has(t.name));
}
