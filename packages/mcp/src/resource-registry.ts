/** Content returned when an MCP resource is read. */
export interface ResourceReadResult {
  /** UTF-8 text body of the resource. */
  text: string;
}

/**
 * Declarative definition of an MCP resource served by the Grackle MCP server.
 *
 * `read` is a function (not a static string) so a later phase (#1239) can serve
 * dynamic / per-session / agent-authored content without changing this shape.
 */
export interface ResourceDefinition {
  /** Resource URI, e.g. `ui://grackle/hello-widget`. */
  uri: string;
  /** Human-readable name. */
  name: string;
  /** Optional description shown in `resources/list`. */
  description?: string;
  /** MIME type (e.g. `text/html;profile=mcp-app` for MCP Apps widgets). */
  mimeType: string;
  /** Optional `_meta` (e.g. MCP Apps `McpUiResourceMeta`); omitted in #1237. */
  meta?: Record<string, unknown>;
  /** Produce the resource body. */
  read: () => ResourceReadResult;
}

/**
 * Registry of MCP resource definitions with lookup support — mirrors
 * {@link ToolRegistry}. Static (register-at-startup) in #1237; the mutable /
 * per-session registry for agent-authored widgets is #1239.
 */
export class ResourceRegistry {
  private readonly resources: Map<string, ResourceDefinition> = new Map();

  /** Register a resource. Throws if a resource with the same URI already exists. */
  public register(resource: ResourceDefinition): void {
    if (this.resources.has(resource.uri)) {
      throw new Error(`Duplicate resource uri: ${resource.uri}`);
    }
    this.resources.set(resource.uri, resource);
  }

  /** Register an array of resource definitions. */
  public registerAll(resources: ResourceDefinition[]): void {
    for (const resource of resources) {
      this.register(resource);
    }
  }

  /** Return all registered resources. */
  public list(): ResourceDefinition[] {
    return Array.from(this.resources.values());
  }

  /** Look up a resource by URI. Returns undefined if not found. */
  public get(uri: string): ResourceDefinition | undefined {
    return this.resources.get(uri);
  }
}
