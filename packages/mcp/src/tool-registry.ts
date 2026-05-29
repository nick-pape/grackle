import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { RENDER_TOOL_PREFIX } from "@grackle-ai/common";
import type { ZodType } from "zod";
import type { AuthContext } from "@grackle-ai/auth";

/** Per-service ConnectRPC clients passed to every MCP tool handler. */
export interface GrackleClients {
  /** Core RPCs: environments, sessions, workspaces, tokens, settings, etc. */
  core: Client<typeof grackle.GrackleCore>;
  /** Orchestration RPCs: tasks, personas, escalations. */
  orchestration: Client<typeof grackle.GrackleOrchestration>;
  /** Scheduling RPCs: schedules. */
  scheduling: Client<typeof grackle.GrackleScheduling>;
  /** Knowledge graph RPCs. */
  knowledge: Client<typeof grackle.GrackleKnowledge>;
}

/** Content item returned by an MCP tool handler. */
export interface ToolContent {
  type: "text";
  text: string;
}

/** Result returned by a tool handler to the MCP protocol layer. */
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  /**
   * Standard MCP result metadata. Used internally by the widget tools to hand a
   * render descriptor to the broker capture (see {@link WIDGET_RENDER_META_KEY}).
   */
  _meta?: { [key: string]: unknown };
}

/** Optional hints about a tool's behavior for the MCP client. */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Declarative authorization target for central, fail-closed scope enforcement
 * (GHSA-f9ff-5x35-7gfw). When a tool sets `scope`, the dispatcher verifies — for
 * every scoped, non-root caller — that the caller is an ancestor of the targeted
 * task (or of the task owning the targeted session) *before* invoking the
 * handler. Because the backend gRPC handlers perform no caller-based
 * authorization, this is the sole authorization boundary for agent callers, so
 * any task/session-mutating tool that omits a descriptor fails *closed* only if
 * the omission is deliberate. Exactly one of the arg fields should be set.
 */
export interface ToolScope {
  /** Name of the input arg holding the target task ID; caller must be its ancestor. */
  taskIdArg?: string;
  /** Name of the input arg holding a session ID; resolved to its task, then ancestry-checked. */
  sessionIdArg?: string;
}

/** Declarative definition of an MCP tool backed by a ConnectRPC call. */
export interface ToolDefinition {
  /** Unique tool name (snake_case by convention). */
  name: string;
  /** Tool group for organizational purposes (e.g. "env", "session"). */
  group: string;
  /** Human-readable description shown to the AI client (20+ chars). */
  description: string;
  /** Zod schema for input validation (converted to JSON Schema for ListTools). */
  inputSchema: ZodType;
  /** Name of the ConnectRPC method this tool calls (e.g. "listEnvironments"). */
  rpcMethod: string;
  /** Whether this tool modifies state. */
  mutating: boolean;
  /** Optional behavioral hints for the client. */
  annotations?: ToolAnnotations;
  /**
   * Optional MCP Apps UI resource (`ui://…`) this tool renders. When set, the
   * tool carries `_meta.ui.resourceUri` in `tools/list` and is only listed to
   * hosts that advertise the `io.modelcontextprotocol/ui` extension.
   */
  uiResourceUri?: string;
  /**
   * Optional declarative scope target for central fail-closed authorization of
   * scoped (agent) callers. See {@link ToolScope}.
   */
  scope?: ToolScope;
  /** Execute the tool, forwarding to the ConnectRPC backend. */
  handler: (
    args: Record<string, unknown>,
    clients: GrackleClients,
    authContext?: AuthContext,
  ) => Promise<ToolResult>;
}

/** Predicate function for filtering tools (used by persona-scoped filtering). */
export type ToolPredicate = (tool: ToolDefinition) => boolean;

/** Registry of MCP tool definitions with lookup and filtering support. */
export class ToolRegistry {
  private readonly tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a tool definition. Throws if a tool with the same name already
   * exists, or if the name uses the reserved `render_` prefix — that namespace
   * belongs to the dynamic per-workspace component render tools (#1272), so no
   * static or plugin-contributed tool may claim it (otherwise it would shadow a
   * promoted component's tool).
   */
  public register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    if (tool.name.startsWith(RENDER_TOOL_PREFIX)) {
      throw new Error(
        `Tool name "${tool.name}" uses the reserved "${RENDER_TOOL_PREFIX}" prefix (reserved for dynamic component render tools, #1272)`,
      );
    }
    this.tools.set(tool.name, tool);
  }

  /** Register an array of tool definitions. */
  public registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** Return all registered tools, optionally filtered by a predicate. */
  public list(predicate?: ToolPredicate): ToolDefinition[] {
    const all = Array.from(this.tools.values());
    if (predicate) {
      return all.filter(predicate);
    }
    return all;
  }

  /** Look up a tool by name. Returns undefined if not found. */
  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
}
