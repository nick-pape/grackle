import { ToolRegistry } from "../tool-registry.js";
import { envTools } from "./env.js";
import { sessionTools } from "./session.js";
import { projectTools } from "./project.js";
import { taskTools } from "./task.js";
import { findingTools } from "./finding.js";
import { personaTools } from "./persona.js";
import { logsTools } from "./logs.js";

/** Create a ToolRegistry pre-populated with all available MCP tools. */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerAll(envTools);
  registry.registerAll(sessionTools);
  registry.registerAll(projectTools);
  registry.registerAll(taskTools);
  registry.registerAll(findingTools);
  registry.registerAll(personaTools);
  registry.registerAll(logsTools);
  return registry;
}
