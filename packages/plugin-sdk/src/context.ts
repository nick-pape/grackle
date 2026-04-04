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

/** Event types emitted by the domain event bus. */
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
  | "finding.posted"
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
  | "notification.escalated"
  | "plugin.changed"
  | "github_account.changed";

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
  /** Subscribe to all domain events. Returns an unsubscribe function. */
  subscribe: (cb: (event: GrackleEvent) => void) => () => void;
  /** Emit a domain event. */
  emit: (type: GrackleEventType, payload: Record<string, unknown>) => GrackleEvent;
  /** Structured logger (pino). */
  logger: Logger;
  /** Resolved server configuration. */
  config: ServerConfig;
}

/** Factory function that creates a subscriber and returns a Disposable for cleanup. */
export type SubscriberFactory = (ctx: PluginContext) => Disposable;
