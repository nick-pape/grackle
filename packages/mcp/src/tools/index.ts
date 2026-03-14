import { ToolRegistry } from "../tool-registry.js";
import { listEnvironmentsTool } from "./list-environments.js";
import { listProjectsTool } from "./list-projects.js";

/** Create a ToolRegistry pre-populated with all available MCP tools. */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(listEnvironmentsTool);
  registry.register(listProjectsTool);
  return registry;
}
