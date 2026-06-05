/**
 * Shared type definitions for the AHP handler modules.
 * @module ahp-types
 */

import type { ResourceChange, ResourceWatchState } from "@grackle-ai/ahp";
import type { AhpServerSocketOptions } from "@grackle-ai/ahp-transport";
import type { MapperContext } from "@grackle-ai/common";
import type { FSWatcher } from "chokidar";

/**
 * Per-(client, session) forwarder state. Tracks the mapper context for the
 * forward `mapAgentEvent` calls and the abort signal that lets a disconnect
 * tear down the forwarder.
 */
export interface ForwarderState {
  readonly mapperContext: MapperContext;
  serverSeq: number;
  cancelled: boolean;
  /**
   * Snapshot of the last `_meta` payload we emitted via
   * `SessionMetaChangedAction`. Used to suppress no-op re-emissions when the
   * mapper's `carried` disposition fires for a non-meta reason (e.g.
   * diagnostic system events).
   */
  lastMetaSnapshot: Record<string, unknown> | undefined;
  /**
   * Index into the {@link SessionPump.buffer} this forwarder has consumed up
   * to. The disconnect path reads this to compute the unsent tail to park.
   */
  pos: number;
  /**
   * If set, the resolver for the forwarder's current sleep on the pump's
   * `waiters` set. Stashed so cancellation paths can wake the forwarder
   * synchronously instead of waiting on the next buffer push.
   */
  wake?: () => void;
}

/**
 * A live filesystem watch created via `createResourceWatch`. The watcher is
 * lazily started when a client `subscribe`s to the watch channel and released
 * on unsubscribe / disconnect. Change events are coalesced into batched
 * ResourceWatchChangedActions delivered over the standard `action` notification.
 */
export interface ResourceWatchEntry {
  /** Absolute, sandbox-validated root path being watched. */
  readonly rootPath: string;
  /** Descriptor returned to a (re)subscribing client. */
  readonly descriptor: ResourceWatchState;
  /** Monotonic per-channel sequence for emitted action envelopes. */
  serverSeq: number;
  /** The chokidar watcher, once subscription has started it. */
  watcher?: FSWatcher;
  /** Pending coalesced changes keyed by URI (latest type wins). */
  readonly pending: Map<string, ResourceChange>;
  /** Active coalesce-flush timer, if one is scheduled. */
  flushTimer?: ReturnType<typeof setTimeout>;
  /**
   * Set once the watch has been torn down. Guards against a late chokidar event
   * (delivered after the async `watcher.close()` is requested) re-arming a flush
   * timer and emitting a phantom batch on an already-unsubscribed channel.
   */
  stopped?: boolean;
}

/**
 * Per-client tracking so onDisconnect can kill+park each session owned by that
 * client.
 */
export interface ClientState {
  readonly sessionIds: Set<string>;
  /** Active forwarders keyed by sessionId (we tear them down on disconnect). */
  readonly forwarders: Map<string, ForwarderState>;
  /**
   * Filesystem roots this connection may read/list/watch — the union of each
   * created session's working directory and (when worktrees are enabled) its
   * sibling worktree path. Shared by `resourceRead`/`resourceList`/
   * `createResourceWatch` sandboxing.
   */
  readonly allowedRoots: Set<string>;
  /** Resource watches keyed by their `ahp-resource-watch:/<id>` channel URI. */
  readonly watches: Map<string, ResourceWatchEntry>;
}

/** Options for {@link mountAhpServer}. */
export interface MountAhpServerOptions {
  /** The HTTP/HTTP2 server to attach the AHP WebSocket upgrade to. */
  readonly server: AhpServerSocketOptions["server"];
  /** Bearer token validated on the HTTP upgrade. */
  readonly powerlineToken: string;
  /** Path component of the WS URL. Defaults to `/ahp`. */
  readonly path?: string;
}

/** Lazy-initialize or fetch the per-client state entry. */
export function getOrCreateClientState(
  clients: Map<string, ClientState>,
  clientId: string,
): ClientState {
  let state = clients.get(clientId);
  if (state === undefined) {
    state = {
      sessionIds: new Set<string>(),
      forwarders: new Map(),
      allowedRoots: new Set<string>(),
      watches: new Map(),
    };
    clients.set(clientId, state);
  }
  return state;
}
