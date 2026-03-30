import { ToolRegistry, type ToolDefinition } from "../tool-registry.js";
import { envTools } from "./env.js";
import { sessionTools } from "./session.js";
import { workspaceTools } from "./workspace.js";
import { taskTools } from "./task.js";
import { findingTools } from "./finding.js";
import { personaTools } from "./persona.js";
import { logsTools } from "./logs.js";
import { credentialTools } from "./credential.js";
import { tokenTools } from "./token.js";
import { configTools } from "./config.js";
import { ipcTools } from "./ipc.js";
import { usageTools } from "./usage.js";
import { knowledgeTools } from "./knowledge.js";
import { workpadTools } from "./workpad.js";
import { scheduleTools } from "./schedule.js";
import { versionTools } from "./version.js";
import { escalationTools } from "./escalation.js";

/** Built-in tool groups shipped with the MCP package. */
const builtinToolGroups: ToolDefinition[][] = [
  envTools,
  sessionTools,
  workspaceTools,
  taskTools,
  findingTools,
  personaTools,
  logsTools,
  credentialTools,
  tokenTools,
  configTools,
  ipcTools,
  usageTools,
  knowledgeTools,
  workpadTools,
  scheduleTools,
  versionTools,
  escalationTools,
];

/**
 * Create a ToolRegistry pre-populated with all built-in MCP tools.
 *
 * @param additionalToolGroups - Optional arrays of plugin-contributed tool definitions
 *   to register after the built-in tools.
 */
export function createToolRegistry(additionalToolGroups?: ToolDefinition[][]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const group of builtinToolGroups) {
    registry.registerAll(group);
  }
  if (additionalToolGroups) {
    for (const group of additionalToolGroups) {
      registry.registerAll(group);
    }
  }
  return registry;
}
