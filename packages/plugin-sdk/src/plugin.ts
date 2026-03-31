/**
 * GracklePlugin interface — the universal plugin contract.
 *
 * A plugin contributes server capabilities through five extension points:
 * gRPC handlers, reconciliation phases, MCP tools, event subscribers,
 * and lifecycle hooks.
 *
 * @module
 */

import type { DescService } from "@bufbuild/protobuf";
import type { PluginContext, Disposable } from "./context.js";

/** A set of gRPC handler methods contributed to a ConnectRPC service. */
export interface ServiceRegistration {
  /** The proto service definition (e.g., grackle.GrackleCore, grackle.GrackleOrchestration). */
  service: DescService;
  /**
   * Handler method implementations.
   *
   * Uses `any` because handler functions have concrete parameter types that
   * are not assignable to `(...args: unknown[]) => unknown` due to contravariance.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlers: Record<string, (...args: any[]) => any>;
}

/** A named async phase that runs during each reconciliation tick. */
export interface ReconciliationPhase {
  /** Short name for logging (e.g. "cron", "dispatch"). */
  name: string;
  /** Execute the phase. Errors are caught by the manager. */
  execute: () => Promise<void>;
}

/**
 * Declarative MCP tool definition contributed by a plugin.
 *
 * Intentionally uses `unknown` for schema/handler types to avoid depending
 * on `@grackle-ai/mcp`. The server maps these to concrete ToolDefinition
 * objects when registering with the MCP tool registry.
 */
export interface PluginToolDefinition {
  /** Unique tool name (snake_case by convention). */
  name: string;
  /** Logical group for filtering (e.g. "task", "session"). */
  group: string;
  /** Human-readable description. */
  description: string;
  /** Zod schema for input validation. */
  inputSchema: unknown;
  /** The gRPC method this tool calls. */
  rpcMethod: string;
  /** Whether this tool mutates state. */
  mutating: boolean;
  /** Optional MCP tool annotations. */
  annotations?: Record<string, unknown>;
  /** Handler function invoked when the tool is called. */
  handler: (args: unknown, client: unknown, authContext?: unknown) => Promise<unknown>;
}

/**
 * A Grackle plugin that contributes server capabilities.
 *
 * Plugins are loaded by {@link loadPlugins} in topological order based on
 * declared dependencies. Each plugin can contribute gRPC handlers,
 * reconciliation phases, MCP tools, and event subscribers.
 */
export interface GracklePlugin {
  /** Unique identifier (e.g., "core", "orchestration", "my-linear-sync"). */
  name: string;
  /** Plugins this one requires. The loader topologically sorts on this. */
  dependencies?: string[];

  /** gRPC handler groups to register on ConnectRPC services. */
  grpcHandlers?: (ctx: PluginContext) => ServiceRegistration[];
  /** Reconciliation phases to run on each tick. */
  reconciliationPhases?: (ctx: PluginContext) => ReconciliationPhase[];
  /** MCP tool definitions to register. */
  mcpTools?: (ctx: PluginContext) => PluginToolDefinition[];
  /** Event subscribers to wire up. Returns disposables for shutdown. */
  eventSubscribers?: (ctx: PluginContext) => Disposable[];

  /** Called after dependency plugins are initialized, in dependency order. */
  initialize?: (ctx: PluginContext) => Promise<void>;
  /** Called on graceful shutdown, in reverse load order. */
  shutdown?: () => Promise<void>;
}
