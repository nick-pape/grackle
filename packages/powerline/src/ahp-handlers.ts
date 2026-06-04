/**
 * PowerLine AHP handlers (AHP HR8d / #1336).
 *
 * Mounts an {@link AhpServerSocket} on an existing HTTP/HTTP2 server and
 * routes incoming AHP JSON-RPC requests + notifications to the existing
 * PowerLine session machinery (runtime registry, session-mgr,
 * token-writer).
 *
 * Wire-protocol summary (per #1336, Option E):
 *
 * - `initialize` — handshake, return canned `InitializeResult` (no host
 *   state; PowerLine session channels are declared stateless).
 * - `createSession` — interpret `params.config` as Grackle's spawn shape.
 *   If `config.resumeFromRuntimeSessionId` is present, call `runtime.resume`;
 *   else call `runtime.spawn`. Store the resulting `AgentSession` in the
 *   existing in-memory registry.
 * - `subscribe` — set up the per-(session, client) forwarder: drain any
 *   parked events for the session as `action` notifications first, then
 *   forward each live `AgentEvent` from `session.stream()` through the
 *   forward mapper as `action` notifications. Return
 *   `SubscribeResult { snapshot: undefined }` — session channels are
 *   stateless from AHP's POV; state is conveyed via the action stream.
 * - `dispatchAction` notification — if the action is
 *   `SessionTurnStartedAction`, route the `message.text` to
 *   `session.sendInput`. Other client-dispatchable actions are no-ops
 *   for now (none used by Grackle today).
 * - `disposeSession` — `session.kill()` + remove from registry.
 * - `listSessions` — map the in-memory registry to `ListSessionsResult`.
 * - `authenticate` — interpret `params.resource` as
 *   `grackle://provider/{provider}/{name}`; parse `params.token` as a
 *   JSON-encoded `{ type, envVar?, filePath?, value }`. Dispatch to the
 *   existing HR6 credential delivery.
 * - `ping` — return `null`.
 *
 * On disconnect (heartbeat timeout or client close), enumerate this
 * client's active sessions, kill each agent, drain its buffered queue, and
 * park the events in the existing in-memory map for replay on next
 * `subscribe`.
 *
 * @module ahp-handlers
 */

import type {
  ActionType as ActionTypeT,
  AuthenticateParams,
  AuthenticateResult,
  CreateResourceWatchParams,
  CreateResourceWatchResult,
  CreateSessionParams,
  DispatchActionParams,
  DisposeSessionParams,
  InitializeParams,
  InitializeResult,
  ListSessionsParams,
  ListSessionsResult,
  PingParams,
  ResourceChange,
  ResourceListParams,
  ResourceReadParams,
  ResourceWatchChangedAction,
  ResourceWatchState,
  SessionStatus as SessionStatusT,
  SessionSummary,
  StateAction,
  SubscribeParams,
  SubscribeResult,
  URI,
  AhpRequest,
  AhpResponse,
  AhpNotification,
} from "@grackle-ai/ahp";
import {
  ActionType,
  AhpErrorCodes,
  JsonRpcErrorCodes,
  MessageKind,
  ResourceChangeType,
  SessionStatus,
} from "@grackle-ai/ahp";
import {
  AhpServerSocket,
  type AhpServerConnection,
  type AhpServerSocketOptions,
} from "@grackle-ai/ahp-transport";
import { mapAgentEvent, type MapperContext } from "@grackle-ai/common";
import type { AgentEvent, AgentSession } from "@grackle-ai/runtime-sdk";
import { validateGitBranchName, worktreeDir } from "@grackle-ai/runtime-sdk";
import { type FSWatcher, watch as chokidarWatch } from "chokidar";
import picomatch from "picomatch";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  join as joinPath,
  relative as relativePath,
  resolve as resolvePath,
  sep as pathSep,
} from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertWithinRoots,
  isResourceError,
  listResource,
  readResource,
  ResourceError,
  resourceUriToPath,
} from "./resource-fs.js";

import { logger } from "./logger.js";
import { coalesceChangeType, COALESCE_DROP } from "./resource-watch-coalesce.js";
import { getRuntime } from "./runtime-registry.js";
import {
  deleteSessionPump,
  drainParkedSession,
  getSession,
  getSessionPump,
  isParked,
  listAllSessions,
  parkSession,
  registerPumpForwarder,
  removeSession,
  startSessionPump,
  unregisterPumpForwarder,
} from "./session-mgr.js";
import { writeTokens } from "./token-writer.js";

const PROTOCOL_VERSION: string = "0.1.0";
const SESSION_CHANNEL_PREFIX: string = "ahp-session:/";
const RESOURCE_WATCH_CHANNEL_PREFIX: string = "ahp-resource-watch:/";
/**
 * Window over which raw filesystem events are coalesced into a single
 * `resourceWatch/changed` action batch, to keep the action stream tractable
 * under bursty writes (e.g. an editor's atomic save).
 */
const WATCH_COALESCE_MS: number = 75;

/**
 * Maximum number of concurrent resource watches a single connection may hold.
 * Each subscribed watch consumes OS file-watch descriptors, so this bounds a
 * buggy or hostile client's ability to exhaust them. Generous for any real
 * document-viewer consumer.
 */
const MAX_RESOURCE_WATCHES_PER_CONNECTION: number = 64;

/**
 * Validate an optional AHP `GlobSet` ({@link ResourceWatchState.excludes} /
 * `includes`) from untrusted client params: it must be `undefined` or an object
 * with an `items` array of strings.
 *
 * @throws ResourceError with `InvalidParams` for any other shape.
 */
function assertGlobSet(value: unknown, field: string): void {
  if (value === undefined) {
    return;
  }
  const items =
    typeof value === "object" && value !== null ? (value as { items?: unknown }).items : undefined;
  if (!Array.isArray(items) || !items.every((g) => typeof g === "string")) {
    throw new ResourceError(
      JsonRpcErrorCodes.InvalidParams,
      `createResourceWatch: ${field} must be { items: string[] }`,
    );
  }
}

/**
 * Decode a session URI to its underlying sessionId. Returns undefined for
 * non-session URIs OR for the bare prefix `ahp-session:/` with no id
 * (which would otherwise produce an empty sessionId and collide on
 * createSession/subscribe/dispose).
 */
function sessionIdFromChannel(channel: URI): string | undefined {
  if (!channel.startsWith(SESSION_CHANNEL_PREFIX)) {
    return undefined;
  }
  const id = channel.slice(SESSION_CHANNEL_PREFIX.length);
  return id.length > 0 ? id : undefined;
}

/** Encode a sessionId as an AHP session URI. */
function sessionChannel(sessionId: string): URI {
  return `${SESSION_CHANNEL_PREFIX}${sessionId}`;
}

/**
 * Per-(client, session) forwarder state. Tracks the mapper context for the
 * forward `mapAgentEvent` calls and the abort signal that lets a disconnect
 * tear down the forwarder.
 */
interface ForwarderState {
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
 * Status-event contents that PowerLine rescues by synthesizing a
 * `SessionMetaChangedAction` with `_meta.status`. mapAgentEvent drops these
 * as "redundant with turn_* events", but Grackle's consumer relies on them
 * to flip `session.status` in the UI.
 *
 * Includes the terminal statuses (`killed` / `terminated` / `failed`) a runtime
 * emits on SIGTERM/abort — without them, a killed session's final status is
 * dropped on the wire and the UI is left believing the session is still alive
 * (#1356). They all map to `stopped` via the consumer's `mapSessionStatus`.
 *
 * Hoisted to module scope (not per-call) since the set is constant and
 * `emitActionsForEvent` is a hot path.
 */
const STATUS_RESCUE_CONTENTS: ReadonlySet<string> = new Set([
  "running",
  "waiting_input",
  "completed",
  "idle",
  "killed",
  "terminated",
  "failed",
]);

/**
 * A live filesystem watch created via `createResourceWatch`. The watcher is
 * lazily started when a client `subscribe`s to the watch channel and released
 * on unsubscribe / disconnect. Change events are coalesced into batched
 * {@link ResourceWatchChangedAction}s delivered over the standard `action`
 * notification.
 */
interface ResourceWatchEntry {
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
 * Per-client tracking so {@link onDisconnect} can kill+park each session
 * owned by that client.
 */
interface ClientState {
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

/**
 * Mount the AHP server on the given HTTP server, wiring all the PowerLine
 * handlers. Returns the {@link AhpServerSocket} so the caller can close it.
 *
 * @param opts - Mount configuration.
 * @returns The mounted server socket.
 */
export function mountAhpServer(opts: MountAhpServerOptions): AhpServerSocket {
  const clients: Map<string, ClientState> = new Map();

  function clientState(conn: AhpServerConnection): ClientState {
    let state = clients.get(conn.clientId);
    if (state === undefined) {
      state = {
        sessionIds: new Set<string>(),
        forwarders: new Map(),
        allowedRoots: new Set<string>(),
        watches: new Map(),
      };
      clients.set(conn.clientId, state);
    }
    return state;
  }

  function jsonRpcError(req: AhpRequest, code: number, message: string): AhpResponse {
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: { code, message },
    } satisfies AhpResponse;
  }

  function jsonRpcSuccess<T>(req: AhpRequest, result: T): AhpResponse {
    return {
      jsonrpc: "2.0",
      id: req.id,
      result,
    } as AhpResponse;
  }

  /**
   * Record the filesystem roots a newly-created session exposes for resource
   * read/list/watch: the session's working directory and, when worktrees are
   * enabled, its sibling worktree path (computed with the same {@link worktreeDir}
   * the runtime uses, so the host and runtime agree on the location). Best
   * effort — a session without a working directory contributes no root.
   */
  function addSessionRoots(cState: ClientState, cfg: Record<string, unknown>): void {
    const wd =
      typeof cfg.workingDirectory === "string" && cfg.workingDirectory !== ""
        ? cfg.workingDirectory
        : undefined;
    if (wd === undefined) {
      return;
    }
    const root = resolvePath(wd);
    cState.allowedRoots.add(root);
    const branch = typeof cfg.branch === "string" && cfg.branch !== "" ? cfg.branch : undefined;
    // Mirror the runtime default: BaseAgentSession treats an omitted useWorktrees
    // as `true` (`opts.useWorktrees ?? true`), so only an explicit `false` disables
    // worktrees. If the host required an explicit `true` here, a session created
    // with a branch and no useWorktrees would edit in the sibling worktree while
    // the sandbox stayed pinned to the original working directory — rejecting the
    // actual edited files with PermissionDenied.
    const useWorktrees = cfg.useWorktrees !== false;
    if (useWorktrees && branch !== undefined) {
      cState.allowedRoots.add(worktreeDir(root, branch));
    }
  }

  /** Translate a thrown {@link ResourceError} (or unknown error) into a wire response. */
  function resourceErrorToResponse(req: AhpRequest, err: unknown): AhpResponse {
    if (isResourceError(err)) {
      return jsonRpcError(req, err.code, err.message);
    }
    return jsonRpcError(
      req,
      JsonRpcErrorCodes.InternalError,
      err instanceof Error ? err.message : String(err),
    );
  }

  // ─── handler bodies ───────────────────────────────────────────

  function handleInitialize(_params: InitializeParams): InitializeResult {
    return {
      protocolVersion: PROTOCOL_VERSION,
      serverSeq: 0,
      snapshots: [],
    };
  }

  function handleCreateSession(
    params: CreateSessionParams,
    conn: AhpServerConnection,
  ): AhpResponse | undefined {
    const sessionId = sessionIdFromChannel(params.channel);
    if (sessionId === undefined) {
      return {
        jsonrpc: "2.0",
        id: 0, // overwritten by caller
        error: {
          code: JsonRpcErrorCodes.InvalidParams,
          message: `createSession: channel must be ${SESSION_CHANNEL_PREFIX}<sessionId>`,
        },
      } satisfies AhpResponse;
    }
    const runtimeName = params.provider;
    if (runtimeName === undefined) {
      return {
        jsonrpc: "2.0",
        id: 0,
        error: {
          code: JsonRpcErrorCodes.InvalidParams,
          message: "createSession: `provider` is required",
        },
      } satisfies AhpResponse;
    }
    const runtime = getRuntime(runtimeName);
    if (runtime === undefined) {
      return {
        jsonrpc: "2.0",
        id: 0,
        error: {
          code: JsonRpcErrorCodes.InvalidParams,
          message: `Unknown runtime: ${runtimeName}`,
        },
      } satisfies AhpResponse;
    }

    // Reject if a session with this ID already exists AND is not parked. A
    // parked session can be reanimated; a live one would conflict.
    const existing = getSession(sessionId);
    if (existing !== undefined) {
      return {
        jsonrpc: "2.0",
        id: 0,
        error: {
          code: JsonRpcErrorCodes.InvalidRequest,
          message: `Session already active: ${sessionId}`,
        },
      } satisfies AhpResponse;
    }

    const config = params.config ?? {};
    const cfg = config as Record<string, unknown>;
    const resumeId =
      typeof cfg.resumeFromRuntimeSessionId === "string"
        ? cfg.resumeFromRuntimeSessionId
        : undefined;

    let session: AgentSession;
    try {
      if (resumeId !== undefined) {
        session = runtime.resume({
          sessionId,
          runtimeSessionId: resumeId,
        });
      } else {
        const prompt = typeof cfg.prompt === "string" ? cfg.prompt : "";
        const model = typeof cfg.model === "string" ? cfg.model : "";
        const maxTurns = typeof cfg.maxTurns === "number" ? cfg.maxTurns : 0;
        const branchVal =
          typeof cfg.branch === "string" && cfg.branch !== "" ? cfg.branch : undefined;
        // Reject unsafe branch names at the boundary before they reach git (GHSA-vv65).
        if (branchVal !== undefined) {
          try {
            validateGitBranchName(branchVal);
          } catch (err) {
            return {
              jsonrpc: "2.0",
              id: 0,
              error: {
                code: JsonRpcErrorCodes.InvalidParams,
                message: err instanceof Error ? err.message : "Invalid branch name",
              },
            } satisfies AhpResponse;
          }
        }
        const wdVal =
          typeof cfg.workingDirectory === "string" && cfg.workingDirectory !== ""
            ? cfg.workingDirectory
            : undefined;
        const useWorktrees = typeof cfg.useWorktrees === "boolean" ? cfg.useWorktrees : undefined;
        const systemContext =
          typeof cfg.systemContext === "string" && cfg.systemContext !== ""
            ? cfg.systemContext
            : undefined;
        const workspaceId =
          typeof cfg.workspaceId === "string" && cfg.workspaceId !== ""
            ? cfg.workspaceId
            : undefined;
        const taskId = typeof cfg.taskId === "string" ? cfg.taskId : undefined;
        const mcpServersJson = typeof cfg.mcpServersJson === "string" ? cfg.mcpServersJson : "";
        const mcpUrl = typeof cfg.mcpUrl === "string" ? cfg.mcpUrl : "";
        const mcpToken = typeof cfg.mcpToken === "string" ? cfg.mcpToken : "";
        const scriptContent =
          typeof cfg.scriptContent === "string" && cfg.scriptContent !== ""
            ? cfg.scriptContent
            : undefined;
        const pipe =
          typeof cfg.pipe === "string" && cfg.pipe !== ""
            ? (cfg.pipe as import("@grackle-ai/common").PipeMode)
            : undefined;

        session = runtime.spawn({
          sessionId,
          prompt,
          model,
          maxTurns,
          ...(branchVal !== undefined ? { branch: branchVal } : {}),
          ...(wdVal !== undefined ? { workingDirectory: wdVal } : {}),
          ...(useWorktrees !== undefined ? { useWorktrees } : {}),
          ...(systemContext !== undefined ? { systemContext } : {}),
          ...(workspaceId !== undefined ? { workspaceId } : {}),
          ...(taskId !== undefined ? { taskId } : {}),
          mcpServers: mcpServersJson
            ? (JSON.parse(mcpServersJson) as Record<string, unknown>)
            : undefined,
          ...(mcpUrl && mcpToken ? { mcpBroker: { url: mcpUrl, token: mcpToken } } : {}),
          ...(scriptContent !== undefined ? { scriptContent } : {}),
          ...(pipe !== undefined ? { pipe } : {}),
        });
      }
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: 0,
        error: {
          code: JsonRpcErrorCodes.InternalError,
          message: err instanceof Error ? err.message : String(err),
        },
      } satisfies AhpResponse;
    }

    // Drive `session.stream()` exactly once via a per-session pump. Each AHP
    // `subscribe` for this channel attaches a forwarder that tails the pump's
    // buffer — re-entering `stream()` per subscribe would re-kick the
    // runtime's driver (`BaseAgentSession.runSession`) and stack listeners on
    // stub-style sessions. See ForwarderState.pos.
    //
    // The natural-exit hook prunes our `ClientState.sessionIds` set when the
    // pump completes on its own (session.stream() returned without being torn
    // down by dispose/onDisconnect). Without this the set would accumulate
    // dead session IDs across the connection's lifetime. Capture clientId
    // here so the closure doesn't keep `conn` alive.
    const ownerClientId = conn.clientId;
    startSessionPump(session, (deadSessionId) => {
      const owner = clients.get(ownerClientId);
      owner?.sessionIds.delete(deadSessionId);
    });
    const cState = clientState(conn);
    cState.sessionIds.add(sessionId);
    addSessionRoots(cState, cfg);

    return {
      jsonrpc: "2.0",
      id: 0,
      result: null,
    } as AhpResponse;
  }

  /**
   * Allocate a resource-watch channel for a sandbox-validated URI. The watcher
   * itself is started lazily when the client subscribes to the returned channel
   * ({@link startResourceWatch}).
   *
   * @throws ResourceError — `InvalidParams`/`PermissionDenied` (sandbox) or
   * `NotFound` if the watch target does not exist.
   */
  async function createResourceWatchEntry(
    params: CreateResourceWatchParams,
    conn: AhpServerConnection,
  ): Promise<CreateResourceWatchResult> {
    const cState = clientState(conn);
    if (cState.watches.size >= MAX_RESOURCE_WATCHES_PER_CONNECTION) {
      throw new ResourceError(
        JsonRpcErrorCodes.InvalidParams,
        `Too many active resource watches (max ${MAX_RESOURCE_WATCHES_PER_CONNECTION})`,
      );
    }
    // Validate the untrusted glob sets before storing them: startResourceWatch
    // maps over `.items`, so a malformed `{ items: <non-array> }` would otherwise
    // throw a raw TypeError at subscribe time (surfacing as InternalError instead
    // of InvalidParams). Mirrors the encoding guard in readResource.
    assertGlobSet(params.excludes, "excludes");
    assertGlobSet(params.includes, "includes");
    const rootPath = await assertWithinRoots(resourceUriToPath(params.uri), cState.allowedRoots);
    if (!existsSync(rootPath)) {
      throw new ResourceError(AhpErrorCodes.NotFound, `Watch target does not exist: ${params.uri}`);
    }
    const channel = `${RESOURCE_WATCH_CHANNEL_PREFIX}${randomUUID()}`;
    const descriptor: ResourceWatchState = {
      root: params.uri,
      recursive: params.recursive ?? false,
      ...(params.excludes !== undefined ? { excludes: params.excludes } : {}),
      ...(params.includes !== undefined ? { includes: params.includes } : {}),
    };
    cState.watches.set(channel, { rootPath, descriptor, serverSeq: 0, pending: new Map() });
    return { channel };
  }

  /**
   * Flush the coalesced change batch for a watch as a single
   * `resourceWatch/changed` action. Never dispatches an empty batch (per spec).
   */
  function flushResourceWatch(
    conn: AhpServerConnection,
    channel: string,
    entry: ResourceWatchEntry,
  ): void {
    entry.flushTimer = undefined;
    if (entry.stopped === true || entry.pending.size === 0) {
      return;
    }
    const items = [...entry.pending.values()];
    entry.pending.clear();
    const action: ResourceWatchChangedAction = {
      type: ActionType.ResourceWatchChanged,
      changes: { items },
    };
    conn.session.notify("action", {
      channel,
      serverSeq: entry.serverSeq++,
      action,
      origin: undefined,
    });
  }

  /**
   * Start the chokidar watcher for a previously-created watch entry and wire its
   * events into coalesced `resourceWatch/changed` notifications. Idempotent: a
   * second subscribe to the same channel is a no-op.
   *
   * Excludes and `.git` are matched via path-relative {@link picomatch}
   * predicates (uniform across platforms); `includes` is applied as a
   * post-filter on emitted paths (omitted = report everything not excluded).
   */
  function startResourceWatch(
    conn: AhpServerConnection,
    channel: string,
    entry: ResourceWatchEntry,
  ): void {
    if (entry.watcher !== undefined) {
      return;
    }
    // Clear any stopped flag from a prior teardown (e.g. an error-handler tear
    // down followed by a re-subscribe) so the fresh watcher's events are emitted.
    entry.stopped = false;
    const { rootPath, descriptor } = entry;
    const excludeMatchers = (descriptor.excludes?.items ?? []).map((g) => picomatch(g));
    const includeMatchers = (descriptor.includes?.items ?? []).map((g) => picomatch(g));
    const relForMatch = (p: string): string => relativePath(rootPath, p).split(pathSep).join("/");

    // chokidar watches `rootPath`, which is the realpath of the requested URI
    // (assertWithinRoots resolves symlinks). Emit change URIs under the *lexical*
    // root the client asked to watch, so a client that follows a notification
    // with resourceRead passes the lexical sandbox check (allowedRoots holds the
    // lexical working tree, not its realpath). When the root isn't a symlink the
    // two coincide and this is a no-op.
    const lexicalRoot = resourceUriToPath(descriptor.root);
    const emitUriFor = (changedPath: string): string => {
      const rel = relativePath(rootPath, changedPath);
      const lexicalPath = rel === "" ? lexicalRoot : joinPath(lexicalRoot, rel);
      return pathToFileURL(lexicalPath).href;
    };

    const watcher = chokidarWatch(rootPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      // Do not follow symlinks: a symlinked directory inside the root could
      // otherwise lead the watcher to emit events for paths that live outside
      // the sandbox, bypassing the realpath containment guard enforced by
      // resourceRead/resourceList.
      followSymlinks: false,
      // Always skip .git; apply excludes relative to the watch root.
      ignored: (p: string): boolean => {
        if (p.split(pathSep).includes(".git")) {
          return true;
        }
        if (excludeMatchers.length === 0) {
          return false;
        }
        const rel = relForMatch(p);
        return rel !== "" && excludeMatchers.some((m) => m(rel));
      },
      // recursive => unlimited depth; non-recursive => only the root's direct
      // entries (depth 0; depth 1 would descend into immediate subdirectories).
      depth: descriptor.recursive ? undefined : 0,
    });
    entry.watcher = watcher;

    const record =
      (type: ResourceChangeType): ((changedPath: string) => void) =>
      (changedPath: string): void => {
        // A late event delivered after teardown (watcher.close() is async) must
        // not re-arm a timer or emit on the unsubscribed channel.
        if (entry.stopped === true) {
          return;
        }
        if (includeMatchers.length > 0) {
          const rel = relForMatch(changedPath);
          if (rel !== "" && !includeMatchers.some((m) => m(rel))) {
            return;
          }
        }
        const uri = emitUriFor(changedPath);
        // Coalesce against any pending change for this URI: add→delete drops as a
        // net no-op; add→change keeps Added (the client learns the file exists,
        // not that it changed); otherwise latest wins. See coalesceChangeType.
        const next = coalesceChangeType(entry.pending.get(uri)?.type, type);
        if (next === COALESCE_DROP) {
          entry.pending.delete(uri);
        } else {
          entry.pending.set(uri, { uri, type: next });
        }
        if (entry.pending.size > 0 && entry.flushTimer === undefined) {
          entry.flushTimer = setTimeout(() => {
            flushResourceWatch(conn, channel, entry);
          }, WATCH_COALESCE_MS);
        }
      };

    watcher.on("add", record(ResourceChangeType.Added));
    watcher.on("addDir", record(ResourceChangeType.Added));
    watcher.on("change", record(ResourceChangeType.Updated));
    watcher.on("unlink", record(ResourceChangeType.Deleted));
    watcher.on("unlinkDir", record(ResourceChangeType.Deleted));
    // FSWatcher is an EventEmitter: an unhandled "error" event would crash the
    // PowerLine process. Log and tear the watch down (the client can recreate it).
    watcher.on("error", (err: unknown): void => {
      logger.error({ err, channel }, "Resource watch error; tearing down watch");
      stopResourceWatch(entry);
    });
  }

  /** Release a watch's filesystem resources (watcher + pending flush timer). */
  function stopResourceWatch(entry: ResourceWatchEntry): void {
    // Mark stopped first so any event already queued behind the async close()
    // is ignored by `record`/`flushResourceWatch`.
    entry.stopped = true;
    if (entry.flushTimer !== undefined) {
      clearTimeout(entry.flushTimer);
      entry.flushTimer = undefined;
    }
    entry.pending.clear();
    // Detach our event listeners synchronously (close() is async) so no further
    // events reach `record` even within the close window. Only our own events are
    // removed (not chokidar internals).
    const w = entry.watcher;
    if (w !== undefined) {
      for (const ev of ["add", "addDir", "change", "unlink", "unlinkDir", "error"]) {
        w.removeAllListeners(ev);
      }
      w.close().catch(() => undefined);
    }
    entry.watcher = undefined;
  }

  function handleSubscribe(params: SubscribeParams, conn: AhpServerConnection): AhpResponse {
    // Resource-watch channels: start the lazily-created watcher and stream
    // change batches. Events-only — the snapshot is omitted (the vendored
    // `Snapshot.state` union does not include `ResourceWatchState`).
    if (params.channel.startsWith(RESOURCE_WATCH_CHANNEL_PREFIX)) {
      const entry = clientState(conn).watches.get(params.channel);
      if (entry === undefined) {
        return {
          jsonrpc: "2.0",
          id: 0,
          error: {
            code: JsonRpcErrorCodes.InvalidParams,
            message: `Unknown resource-watch channel: ${params.channel}`,
          },
        } satisfies AhpResponse;
      }
      startResourceWatch(conn, params.channel, entry);
      return {
        jsonrpc: "2.0",
        id: 0,
        result: { snapshot: undefined } satisfies SubscribeResult,
      } as AhpResponse;
    }
    return handleSessionSubscribe(params, conn);
  }

  function handleSessionSubscribe(params: SubscribeParams, conn: AhpServerConnection): AhpResponse {
    const sessionId = sessionIdFromChannel(params.channel);
    if (sessionId === undefined) {
      // Subscribing to non-session channels (e.g. ahp-root://) — return an
      // empty SubscribeResult; root state notifications are not implemented.
      return {
        jsonrpc: "2.0",
        id: 0,
        result: { snapshot: undefined } satisfies SubscribeResult,
      } as AhpResponse;
    }
    const session = getSession(sessionId);
    if (session === undefined && !isParked(sessionId)) {
      return {
        jsonrpc: "2.0",
        id: 0,
        error: {
          code: JsonRpcErrorCodes.InvalidParams,
          message: `Unknown session channel: ${params.channel}`,
        },
      } satisfies AhpResponse;
    }

    const cState = clientState(conn);
    // Tear down any prior forwarder for this session (avoid double-forwarding
    // if subscribe is called twice for the same channel). Wake it
    // synchronously so its tail loop notices `cancelled` and exits without
    // waiting on the next pump push.
    const prior = cState.forwarders.get(sessionId);
    if (prior !== undefined) {
      prior.cancelled = true;
      prior.wake?.();
    }

    const forwarder: ForwarderState = {
      mapperContext: {
        turnId: undefined,
        openToolCalls: [],
        partCounter: 0,
        eventIndex: 0,
        metaAccumulator: {},
      },
      serverSeq: 0,
      cancelled: false,
      lastMetaSnapshot: undefined,
      pos: 0,
    };
    cState.forwarders.set(sessionId, forwarder);

    // Schedule the parked-event replay + live forwarder to run AFTER the
    // SubscribeResult response is sent. queueMicrotask gives the JSON-RPC
    // layer a chance to flush the response frame first.
    queueMicrotask(() => {
      runForwarder(conn, sessionId, forwarder).catch(() => {
        // Forwarder errors are surfaced via the agent stream's natural
        // failure path; don't unhandled-reject the microtask.
      });
    });

    return {
      jsonrpc: "2.0",
      id: 0,
      result: { snapshot: undefined } satisfies SubscribeResult,
    } as AhpResponse;
  }

  async function runForwarder(
    conn: AhpServerConnection,
    sessionId: string,
    forwarder: ForwarderState,
  ): Promise<void> {
    // If a rapid resubscribe cancelled us between handleSubscribe's
    // `queueMicrotask` and this microtask actually running, bail before we
    // touch anything — in particular don't drain parked events (the
    // next forwarder needs them) and don't register on the pump (a cancelled
    // forwarder bumping `totalForwardersAttached` would cause the *real*
    // next forwarder to skip the first-subscribe replay and start at the
    // tail, missing the runtime's setup events).
    if (forwarder.cancelled) {
      const cState = clients.get(conn.clientId);
      if (cState?.forwarders.get(sessionId) === forwarder) {
        cState.forwarders.delete(sessionId);
      }
      return;
    }
    // Step 1: drain any parked events first. These are the "what did I miss
    // while disconnected" tail from a prior owner of this channel.
    const parked = drainParkedSession(sessionId);
    if (parked !== undefined) {
      for (const event of parked) {
        // forwarder.cancelled is narrowed to false by the entry-check above,
        // but it's mutated externally by handleSubscribe/disposeSession/
        // onDisconnect — re-check between events so a fast cancellation
        // arriving via an unrelated wire op stops emission mid-stream.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (forwarder.cancelled) {
          return;
        }
        emitActionsForEvent(conn, sessionId, event, forwarder);
      }
    }
    // Step 2: tail the live pump. If the session has no pump (parked-only
    // or already disposed) there's nothing live to forward.
    const pump = getSessionPump(sessionId);
    if (pump === undefined) {
      // Forwarder map cleanup still needs to run.
      const cState = clients.get(conn.clientId);
      if (cState?.forwarders.get(sessionId) === forwarder) {
        cState.forwarders.delete(sessionId);
      }
      return;
    }
    // First-ever forwarder on this pump replays from the buffer's logical
    // start so it observes setup events (`runtime_session_id`, initial system
    // messages) the runtime emits between createSession and subscribe — those
    // are the same wire frames the server's processEventStream needs to write
    // `runtimeSessionId` into the DB row, which `recoverSuspendedSessions`
    // later reads to know if reanimate is even possible. Subsequent
    // forwarders are true mid-stream resubscribes and pick up at the current
    // tail; events missed in a disconnect window arrive via the parked-replay
    // path (Step 1 above), not by replaying the live buffer. `forwarder.pos`
    // is always in the pump's *absolute* event-index space so trims of
    // pump.buffer don't shift its meaning.
    forwarder.pos =
      pump.totalForwardersAttached === 0
        ? pump.bufferStartIndex
        : pump.bufferStartIndex + pump.buffer.length;
    registerPumpForwarder(pump, forwarder);
    try {
      // Same TS-narrowing caveat as the parked-replay loop: forwarder.cancelled
      // is mutated by external wire ops and the await below yields control,
      // so the re-check is real even though TS thinks it's always false.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (!forwarder.cancelled) {
        const bufLen = pump.bufferStartIndex + pump.buffer.length;
        while (forwarder.pos < bufLen) {
          const localIdx = forwarder.pos - pump.bufferStartIndex;
          emitActionsForEvent(conn, sessionId, pump.buffer[localIdx]!, forwarder);
          forwarder.pos++;
        }
        if (pump.done) {
          return;
        }
        // Sleep until the pump pushes another event, or until we're cancelled
        // and woken via `forwarder.wake`. The same `settle` closure is used by
        // both wake paths (pump push via wakePumpWaiters, and external
        // cancellation via forwarder.wake?.()) — it clears forwarder.wake so
        // the field never holds a stale reference between iterations.
        await new Promise<void>((resolve) => {
          const settle = (): void => {
            forwarder.wake = undefined;
            pump.waiters.delete(settle);
            resolve();
          };
          forwarder.wake = settle;
          pump.waiters.add(settle);
        });
      }
    } finally {
      // Forwarder map cleanup. Session/pump removal happens in one of three
      // places, none of which is here:
      //   - `unregisterPumpForwarder` above, on the *last*-forwarder-detach
      //     path after `pump.done` (the natural-exit ladder);
      //   - `handleDisposeSession`, when the wire explicitly tears down;
      //   - `onDisconnect`, when the wire drops and we park the unsent tail.
      // This `finally` only owns the per-(client, session) forwarder map
      // entry — the runtime-level registry is somebody else's job.
      unregisterPumpForwarder(pump, forwarder);
      const cState = clients.get(conn.clientId);
      if (cState?.forwarders.get(sessionId) === forwarder) {
        cState.forwarders.delete(sessionId);
      }
    }
  }

  /**
   * Event types whose mapper-drop ("no active turn") should be rescued by
   * synthesizing an orphan turn-started. These are runtime-emitted content
   * events that, under the gRPC wire, flowed through regardless of turn
   * context. The AHP wire is action-only, so an orphan emission would be
   * silently lost — we patch around that here at the wire boundary.
   */
  const ORPHAN_RESCUABLE_TYPES: ReadonlySet<string> = new Set([
    "text",
    "tool_use",
    "tool_result",
    "system",
  ]);

  function emitActionsForEvent(
    conn: AhpServerConnection,
    sessionId: string,
    event: AgentEvent,
    forwarder: ForwarderState,
  ): void {
    const idx = forwarder.mapperContext.eventIndex++;
    // Normalize AgentEvent (with `raw: unknown`) to AgentEventFields
    // (with `raw: string | undefined`) so the mapper signature matches.
    const normalized = {
      type: event.type,
      content: event.content,
      toolCallId: event.toolCallId,
      turnId: event.turnId,
      diagnostic: event.diagnostic,
      toolError: event.toolError,
      timestamp: event.timestamp,
      raw: event.raw !== undefined ? JSON.stringify(event.raw) : undefined,
    };

    // Status rescue (HR8d): mapAgentEvent unconditionally drops status events
    // with content in {running, waiting_input, completed} as "redundant with
    // turn_* events" — but Grackle's consumer uses these to update
    // `sessions.status` (`useSessions.ts` calls `mapSessionStatus(event.content)`).
    // Without them, the UI never observes `latestSession.status === "idle"`
    // and queued chat input never auto-sends. We synthesize a
    // `SessionMetaChangedAction` with `_meta.status` so the consumer's reverse
    // mapper can rehydrate a `status` event with the original content.
    if (event.type === "status" && STATUS_RESCUE_CONTENTS.has(event.content)) {
      forwarder.serverSeq += 1;
      const statusAction: StateAction = {
        type: ActionType.SessionMetaChanged,
        _meta: { status: event.content },
      };
      conn.session.notify("action", {
        channel: sessionChannel(sessionId),
        serverSeq: forwarder.serverSeq,
        action: statusAction,
        origin: undefined,
      });
      return;
    }

    let result = mapAgentEvent(normalized, idx, forwarder.mapperContext);
    let synthesizedOrphanTurnId: string | undefined;

    // Orphan rescue (HR8d): if the mapper dropped a content event because
    // no turn is active, synthesize a `SessionTurnStarted` and re-run the
    // mapper so the event lands inside a turn. Without this, runtimes that
    // emit text/tool events outside a turn (legitimate under the gRPC wire)
    // would have their content silently dropped on the AHP wire.
    if (
      result.actions.length === 0 &&
      result.note?.disposition === "dropped" &&
      ORPHAN_RESCUABLE_TYPES.has(normalized.type) &&
      forwarder.mapperContext.turnId === undefined
    ) {
      synthesizedOrphanTurnId = `turn-orphan-${String(idx)}`;
      const startAction: StateAction = {
        type: ActionType.SessionTurnStarted,
        turnId: synthesizedOrphanTurnId,
        message: { text: "", origin: { kind: MessageKind.User } },
      };
      forwarder.serverSeq += 1;
      conn.session.notify("action", {
        channel: sessionChannel(sessionId),
        serverSeq: forwarder.serverSeq,
        action: startAction,
        origin: undefined,
      });
      // Update context so the re-run sees the synthetic turn as active.
      forwarder.mapperContext.turnId = synthesizedOrphanTurnId;
      // Re-run the mapper with a fresh index. The mapperContext is mutable
      // so the orphan turn is now in scope.
      const reIdx = forwarder.mapperContext.eventIndex++;
      result = mapAgentEvent(normalized, reIdx, forwarder.mapperContext);
    }

    for (const action of result.actions) {
      forwarder.serverSeq += 1;
      conn.session.notify("action", {
        channel: sessionChannel(sessionId),
        serverSeq: forwarder.serverSeq,
        action,
        origin: undefined,
      });
    }

    // Close the synthetic orphan turn after the rescued event lands. This
    // matters for the consumer's UI grouping: an open turn with no `turn_complete`
    // may be held back until completion. Each orphan event gets its own
    // single-content synthetic turn that opens and closes immediately.
    if (synthesizedOrphanTurnId !== undefined) {
      const completeAction: StateAction = {
        type: ActionType.SessionTurnComplete,
        turnId: synthesizedOrphanTurnId,
      };
      forwarder.serverSeq += 1;
      conn.session.notify("action", {
        channel: sessionChannel(sessionId),
        serverSeq: forwarder.serverSeq,
        action: completeAction,
        origin: undefined,
      });
      // The mapper sets context.turnId = undefined inside its
      // SessionTurnComplete case, but we manage the context for the wire
      // forwarder ourselves — clear it now so any subsequent real turn
      // can claim the active-turn slot cleanly.
      forwarder.mapperContext.turnId = undefined;
    }
    // Also synthesize a SessionMetaChangedAction whenever the meta
    // accumulator advances, so the consumer's reverse mapper can rehydrate
    // `usage` / `runtime_session_id` events.
    //
    // Detect "advanced" by comparing against the last snapshot we emitted, not
    // by `result.note?.disposition === "carried"`. The mapper returns
    // `carried` for several non-meta cases too (diagnostic system events,
    // runtime_session_id with no content, etc.), so a disposition check alone
    // re-emits the same `_meta` payload on every carried event and floods the
    // wire. Comparing snapshots makes the emit truly edge-triggered.
    const metaSnapshot: Record<string, unknown> = {};
    if (forwarder.mapperContext.metaAccumulator.runtimeSessionId !== undefined) {
      metaSnapshot.runtime_session_id = forwarder.mapperContext.metaAccumulator.runtimeSessionId;
    }
    if (forwarder.mapperContext.metaAccumulator.costMillicents !== undefined) {
      metaSnapshot.cost_millicents = forwarder.mapperContext.metaAccumulator.costMillicents;
    }
    // HR8d follow-up #1355: carry token totals alongside cost.
    if (forwarder.mapperContext.metaAccumulator.inputTokens !== undefined) {
      metaSnapshot.input_tokens = forwarder.mapperContext.metaAccumulator.inputTokens;
    }
    if (forwarder.mapperContext.metaAccumulator.outputTokens !== undefined) {
      metaSnapshot.output_tokens = forwarder.mapperContext.metaAccumulator.outputTokens;
    }
    if (
      Object.keys(metaSnapshot).length > 0 &&
      !shallowEqualSnapshots(forwarder.lastMetaSnapshot, metaSnapshot)
    ) {
      forwarder.serverSeq += 1;
      const metaAction: StateAction = {
        type: ActionType.SessionMetaChanged,
        _meta: metaSnapshot,
      };
      conn.session.notify("action", {
        channel: sessionChannel(sessionId),
        serverSeq: forwarder.serverSeq,
        action: metaAction,
        origin: undefined,
      });
      forwarder.lastMetaSnapshot = metaSnapshot;
    }
  }

  /** Shallow-equality check for `_meta` snapshot dedup in the forwarder. */
  function shallowEqualSnapshots(
    a: Record<string, unknown> | undefined,
    b: Record<string, unknown>,
  ): boolean {
    if (a === undefined) {
      return false;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    for (const k of aKeys) {
      if (a[k] !== b[k]) {
        return false;
      }
    }
    return true;
  }

  function handleDispatchAction(params: DispatchActionParams, _conn: AhpServerConnection): void {
    const sessionId = sessionIdFromChannel(params.channel);
    if (sessionId === undefined) {
      return;
    }
    const session = getSession(sessionId);
    if (session === undefined) {
      return;
    }
    // Only SessionTurnStartedAction maps to Grackle's `sendInput` semantics.
    if ((params.action as { type: ActionTypeT }).type === ActionType.SessionTurnStarted) {
      const a = params.action as { message: { text: string } };
      session.sendInput(a.message.text);
    }
  }

  function handleDisposeSession(
    params: DisposeSessionParams,
    conn: AhpServerConnection,
  ): AhpResponse {
    const sessionId = sessionIdFromChannel(params.channel);
    if (sessionId === undefined) {
      return {
        jsonrpc: "2.0",
        id: 0,
        error: {
          code: JsonRpcErrorCodes.InvalidParams,
          message: "disposeSession: channel must be ahp-session:/<id>",
        },
      } satisfies AhpResponse;
    }
    const session = getSession(sessionId);
    if (session !== undefined) {
      session.kill("killed");
      // Synchronous removal so the caller sees the session gone immediately
      // on return. The pump's natural-exit cleanup is idempotent — it won't
      // re-remove what's already been removed.
      removeSession(sessionId);
      deleteSessionPump(sessionId);
    }
    const cState = clients.get(conn.clientId);
    if (cState !== undefined) {
      cState.sessionIds.delete(sessionId);
      const fwd = cState.forwarders.get(sessionId);
      if (fwd !== undefined) {
        // Synthesize a terminal `killed` status as the LAST action on the wire
        // before tearing down the forwarder (#1356). The runtime's abort can
        // emit a trailing synthetic `waiting_input`; if that were the final
        // forwarded event the UI would believe the killed session is still
        // alive. Emitting `killed` here and immediately cancelling the
        // forwarder guarantees the session's terminal state is what the
        // consumer sees last. Mirrors the status-rescue block above.
        fwd.serverSeq += 1;
        const killedAction: StateAction = {
          type: ActionType.SessionMetaChanged,
          _meta: { status: "killed" },
        };
        conn.session.notify("action", {
          channel: sessionChannel(sessionId),
          serverSeq: fwd.serverSeq,
          action: killedAction,
          origin: undefined,
        });
        fwd.cancelled = true;
        fwd.wake?.();
        cState.forwarders.delete(sessionId);
      }
    }
    return {
      jsonrpc: "2.0",
      id: 0,
      result: null,
    } as AhpResponse;
  }

  function handleListSessions(_params: ListSessionsParams): ListSessionsResult {
    const items: SessionSummary[] = listAllSessions().map((s: AgentSession) => {
      const now = Date.now();
      return {
        resource: sessionChannel(s.id),
        provider: s.runtimeName,
        title: s.id,
        // Map PowerLine's loose status string to AHP's bitset enum
        // best-effort. Unknown statuses become Idle.
        status: mapAgentStatusToAhp(s.status),
        createdAt: now,
        modifiedAt: now,
      };
    });
    return { items };
  }

  function mapAgentStatusToAhp(status: string): SessionStatusT {
    switch (status) {
      // SessionStatus values (from session.status field)
      case "pending":
        return SessionStatus.InProgress;
      case "running":
        return SessionStatus.InProgress;
      case "idle":
        return SessionStatus.InputNeeded;
      case "stopped":
        return SessionStatus.Error;
      case "suspended":
        return SessionStatus.Idle;
      // Status event content strings (from event stream)
      case "waiting_input":
        return SessionStatus.InputNeeded;
      case "completed":
        return SessionStatus.Idle;
      case "failed":
      case "killed":
      case "terminated":
        return SessionStatus.Error;
      default:
        return SessionStatus.Idle;
    }
  }

  async function handleAuthenticate(
    params: AuthenticateParams,
  ): Promise<AuthenticateResult | { _error: string }> {
    // Grackle field-abuse encoding (per #1336):
    // - resource: `grackle://provider/{provider}/{name}`
    // - token: JSON-encoded { type, envVar?, filePath?, value }
    const match = /^grackle:\/\/provider\/([^/]+)\/(.+)$/.exec(params.resource);
    if (match === null) {
      return { _error: `Unrecognized authenticate resource: ${params.resource}` };
    }
    const [, , name] = match;
    let parsed: { type: string; envVar?: string; filePath?: string; value: string };
    try {
      parsed = JSON.parse(params.token) as typeof parsed;
    } catch {
      return { _error: "authenticate.token must be JSON-encoded credential" };
    }
    await writeTokens([
      {
        name: name!,
        type: parsed.type,
        envVar: parsed.envVar ?? "",
        filePath: parsed.filePath ?? "",
        value: parsed.value,
      },
    ]);
    return {};
  }

  function handlePing(_params: PingParams): null {
    return null;
  }

  // ─── AhpServerSocket wiring ───────────────────────────────────

  const ahp = new AhpServerSocket({
    server: opts.server,
    powerlineToken: opts.powerlineToken,
    ...(opts.path !== undefined ? { path: opts.path } : {}),
    onInitialize: (params: InitializeParams) => handleInitialize(params),

    onRequest: async (req: AhpRequest, conn: AhpServerConnection): Promise<AhpResponse> => {
      const method = req.method;
      switch (method) {
        case "createSession": {
          const resp = handleCreateSession(req.params as CreateSessionParams, conn);
          if (resp !== undefined) {
            return { ...resp, id: req.id };
          }
          return jsonRpcSuccess(req, null);
        }
        case "subscribe": {
          const resp = handleSubscribe(req.params as SubscribeParams, conn);
          return { ...resp, id: req.id };
        }
        case "disposeSession": {
          const resp = handleDisposeSession(req.params as DisposeSessionParams, conn);
          return { ...resp, id: req.id };
        }
        case "listSessions":
          return jsonRpcSuccess(req, handleListSessions(req.params as ListSessionsParams));
        case "authenticate": {
          const result = await handleAuthenticate(req.params as AuthenticateParams);
          if ("_error" in result) {
            return jsonRpcError(req, JsonRpcErrorCodes.InvalidParams, result._error);
          }
          return jsonRpcSuccess(req, result);
        }
        case "ping":
          return jsonRpcSuccess(req, handlePing(req.params as PingParams));
        case "resourceRead": {
          const p = req.params as ResourceReadParams;
          try {
            return jsonRpcSuccess(
              req,
              await readResource(p.uri, clientState(conn).allowedRoots, p.encoding),
            );
          } catch (err) {
            return resourceErrorToResponse(req, err);
          }
        }
        case "resourceList": {
          const p = req.params as ResourceListParams;
          try {
            return jsonRpcSuccess(req, await listResource(p.uri, clientState(conn).allowedRoots));
          } catch (err) {
            return resourceErrorToResponse(req, err);
          }
        }
        case "createResourceWatch": {
          try {
            return jsonRpcSuccess(
              req,
              await createResourceWatchEntry(req.params as CreateResourceWatchParams, conn),
            );
          } catch (err) {
            return resourceErrorToResponse(req, err);
          }
        }
        default:
          return jsonRpcError(req, JsonRpcErrorCodes.MethodNotFound, `Unknown method: ${method}`);
      }
    },

    onNotification: (notif: AhpNotification, conn: AhpServerConnection): void => {
      if (notif.method === "dispatchAction") {
        handleDispatchAction(notif.params as DispatchActionParams, conn);
        return;
      }
      if (notif.method === "unsubscribe") {
        // Releasing a resource-watch subscription closes its watcher (the watch
        // lifecycle is tied to subscription — there is no dispose command).
        const channel = (notif.params as { channel?: string }).channel;
        if (channel?.startsWith(RESOURCE_WATCH_CHANNEL_PREFIX) === true) {
          const cState = clients.get(conn.clientId);
          if (cState !== undefined) {
            const entry = cState.watches.get(channel);
            if (entry !== undefined) {
              stopResourceWatch(entry);
              cState.watches.delete(channel);
            }
          }
        }
        // Session-channel unsubscribe stays a no-op (the forwarder is torn down
        // on resubscribe / dispose / disconnect).
      }
    },

    onDisconnect: (clientId: string): void => {
      const cState = clients.get(clientId);
      if (cState === undefined) {
        return;
      }
      // For each session this client owned, kill + park its unsent events for
      // replay on next subscribe (whoever calls subscribe next, including
      // a reconnecting same-client).
      //
      // The "unsent tail" is the slice of `pump.buffer` past the forwarder's
      // position, concatenated with anything still in the runtime's own
      // queue that the pump hasn't yet pulled. `session.kill()` is sync and
      // closes the runtime queue; the pump task's natural exit (a microtask
      // later) is idempotent — see `runPump`'s finally.
      for (const sessionId of cState.sessionIds) {
        const session = getSession(sessionId);
        const pump = getSessionPump(sessionId);
        const fwd = cState.forwarders.get(sessionId);
        if (session !== undefined && pump !== undefined) {
          session.kill("disconnected");
          const stillInRuntimeQueue = session.drainBufferedEvents();
          // Translate the forwarder's absolute pos into the local buffer
          // slice. If there's no forwarder, start at the buffer's logical
          // start so we capture every event the pump has read.
          const fromAbs = fwd?.pos ?? pump.bufferStartIndex;
          const localStart = Math.max(0, fromAbs - pump.bufferStartIndex);
          const tail = [...pump.buffer.slice(localStart), ...stillInRuntimeQueue];
          if (tail.length > 0) {
            parkSession(sessionId, tail);
          }
          removeSession(sessionId);
          deleteSessionPump(sessionId);
        }
        if (fwd !== undefined) {
          fwd.cancelled = true;
          fwd.wake?.();
        }
      }
      // Release any filesystem watches this client held.
      for (const entry of cState.watches.values()) {
        stopResourceWatch(entry);
      }
      cState.watches.clear();
      clients.delete(clientId);
    },
  });

  return ahp;
}
