import { ResourceRegistry, type ResourceDefinition } from "../resource-registry.js";
import { createHelloWidgetResource } from "./hello-widget.js";

/**
 * Create a ResourceRegistry pre-populated with the built-in MCP Apps resources.
 *
 * @param assetBaseUrl - Public origin of the MCP server (e.g. `http://127.0.0.1:7435`),
 *   embedded into widget HTML so hosts can load the widget's browser assets.
 */
export function createResourceRegistry(assetBaseUrl: string): ResourceRegistry {
  const registry = new ResourceRegistry();
  const builtinResources: ResourceDefinition[] = [createHelloWidgetResource(assetBaseUrl)];
  registry.registerAll(builtinResources);
  return registry;
}
