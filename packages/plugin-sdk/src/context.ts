/**
 * Plugin context types — the runtime environment provided to plugins.
 *
 * Stores (taskStore, sessionStore, etc.) are accessed via direct package
 * imports from `@grackle-ai/database`, not through the context. The context
 * provides only runtime-dynamic infrastructure: event bus, logger, and config.
 *
 * @module
 */

import type { Logger } from "pino";

/** A resource that can be disposed to clean up subscriptions and state. */
export interface Disposable {
  /** Release all resources (unsubscribe callbacks, clear dedup maps, etc.). */
  dispose(): void;
}

/** Resolved server configuration available to plugins. */
export interface ServerConfig {
  /** gRPC server port. */
  grpcPort: number;
  /** Web UI + WebSocket port. */
  webPort: number;
  /** MCP server port. */
  mcpPort: number;
  /** PowerLine server port. */
  powerlinePort: number;
  /** Bind address for all servers. */
  host: string;
  /** Grackle home directory (databases, API key, logs). */
  grackleHome: string;
  /** Loaded API key for authenticated requests. */
  apiKey: string;
  /** Override agent working directory (GRACKLE_WORKING_DIRECTORY). */
  workingDirectory?: string;
  /** Worktree base path (GRACKLE_WORKTREE_BASE). */
  worktreeBase?: string;
  /** Docker host for host mapping (GRACKLE_DOCKER_HOST). */
  dockerHost?: string;
  /** Skip auto-starting the root task when an environment connects. */
  skipRootAutostart?: boolean;
}

/**
 * All domain event types emitted by the event bus.
 *
 * This is the single source of truth. `@grackle-ai/core` re-exports these
 * types from here; do not redefine them elsewhere.
 */
export type GrackleEventType =
  | "task.created"
  | "task.updated"
  | "task.started"
  | "task.completed"
  | "task.deleted"
  | "task.reparented"
  | "workspace.created"
  | "workspace.archived"
  | "workspace.updated"
  | "persona.created"
  | "persona.updated"
  | "persona.deleted"
  | "environment.added"
  | "environment.removed"
  | "environment.changed"
  | "environment.provision_progress"
  | "token.changed"
  | "credential.providers_changed"
  | "setting.changed"
  | "schedule.created"
  | "schedule.updated"
  | "schedule.deleted"
  | "schedule.fired"
  | "agent.created"
  | "agent.updated"
  | "agent.deleted"
  // Heartbeat schedule for an Agent's root task was created/updated/paused (#1438).
  // payload: { agentId }
  | "agent.heartbeat.updated"
  // Heartbeat schedule for an Agent was deleted via SetAgentHeartbeat({ cadence: "" }).
  // payload: { agentId }
  | "agent.heartbeat.cleared"
  | "notification.escalated"
  | "plugin.changed"
  | "github_account.changed"
  // A workspace's promoted-component set changed (promote/demote, or a promoted
  // component edited) — the MCP server pushes tools/list_changed to that
  // workspace's sessions so dynamic render_<name> tools refresh (#1297). payload: { workspaceId }
  | "component.changed"
  // A watched resource (file/dir) changed on an environment's PowerLine-owned
  // worktree (#1395). Forwarded from the AHP resource-watch channel; the web
  // `useResources` hook re-reads the affected URIs. payload:
  // { environmentId, uri, changes: [{ uri, type }] }
  | "resource.changed"
  // IPC stream (room) lifecycle (#1309). Emitted from the stream registry for
  // observable (non-reserved) rooms so the Coordination roster updates live as
  // streams are created/joined/left/closed by either agents or the operator.
  // payloads:
  //   stream.created  { streamId, name, selfEcho }
  //   stream.attached { streamId, name, sessionId, permission, deliveryMode }
  //   stream.detached { streamId, name, sessionId }
  //   stream.closed   { streamId, name }
  | "stream.created"
  | "stream.attached"
  | "stream.detached"
  | "stream.closed"
  // An agent asked the UI to open a read-only live view of a file (#1396 live
  // docs v0). Emitted when the `show_file` MCP tool's result carries a document
  // descriptor; the web `useDocuments` hook opens a tab bound to the URI
  // reference (NOT baked content). payload: { environmentId, uri, sessionId }
  | "document.show";

/** A domain event from the event bus. */
export interface GrackleEvent {
  /** ULID — chronologically sortable unique identifier. */
  id: string;
  /** Dot-notation event type (e.g. "task.created"). */
  type: GrackleEventType;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Domain-specific payload. */
  payload: Record<string, unknown>;
}

/**
 * Runtime context provided to plugins.
 *
 * Stores (taskStore, sessionStore, etc.) are accessed via direct package
 * imports — not injected through the context. This keeps the contract surface
 * minimal and avoids coupling plugins to a fat DI interface.
 */
export interface PluginContext {
  /** Subscribe to all domain events. Returns an unsubscribe function. The callback
   *  may be sync or async; async rejections are caught and logged by the event bus. */
  subscribe: (cb: (event: GrackleEvent) => void | Promise<void>) => () => void;
  /** Emit a domain event. */
  emit: (type: GrackleEventType, payload: Record<string, unknown>) => GrackleEvent;
  /** Structured logger (pino). */
  logger: Logger;
  /** Resolved server configuration. */
  config: ServerConfig;
}

/** Factory function that creates a subscriber and returns a Disposable for cleanup. */
export type SubscriberFactory = (ctx: PluginContext) => Disposable;
