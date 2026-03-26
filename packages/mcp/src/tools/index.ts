import { ToolRegistry } from "../tool-registry.js";
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

/** Create a ToolRegistry pre-populated with all available MCP tools. */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerAll(envTools);
  registry.registerAll(sessionTools);
  registry.registerAll(workspaceTools);
  registry.registerAll(taskTools);
  registry.registerAll(findingTools);
  registry.registerAll(personaTools);
  registry.registerAll(logsTools);
  registry.registerAll(credentialTools);
  registry.registerAll(tokenTools);
  registry.registerAll(configTools);
  registry.registerAll(ipcTools);
  registry.registerAll(usageTools);
  registry.registerAll(knowledgeTools);
  registry.registerAll(workpadTools);
  registry.registerAll(scheduleTools);
  registry.registerAll(versionTools);
  return registry;
}
