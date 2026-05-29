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
 *   `SessionTurnStartedAction`, route the `userMessage.text` to
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
  CreateSessionParams,
  DispatchActionParams,
  DisposeSessionParams,
  InitializeParams,
  InitializeResult,
  ListSessionsParams,
  ListSessionsResult,
  PingParams,
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
import { ActionType, JsonRpcErrorCodes, SessionStatus } from "@grackle-ai/ahp";
import {
  AhpServerSocket,
  type AhpServerConnection,
  type AhpServerSocketOptions,
} from "@grackle-ai/ahp-transport";
import { mapAgentEvent, type MapperContext } from "@grackle-ai/common";
import type { AgentEvent, AgentSession } from "@grackle-ai/runtime-sdk";
import { validateGitBranchName } from "@grackle-ai/runtime-sdk";

import { getRuntime } from "./runtime-registry.js";
import {
  addSession,
  drainParkedSession,
  getSession,
  isParked,
  listAllSessions,
  parkSession,
  removeSession,
} from "./session-mgr.js";
import { writeTokens } from "./token-writer.js";

const PROTOCOL_VERSION: string = "0.1.0";
const SESSION_CHANNEL_PREFIX: string = "ahp-session:/";

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
}

/**
 * Status-event contents that PowerLine rescues by synthesizing a
 * `SessionMetaChangedAction` with `_meta.status`. mapAgentEvent drops these
 * as "redundant with turn_* events", but Grackle's consumer relies on them
 * to flip `session.status` in the UI.
 *
 * Hoisted to module scope (not per-call) since the set is constant and
 * `emitActionsForEvent` is a hot path.
 */
const STATUS_RESCUE_CONTENTS: ReadonlySet<string> = new Set([
  "running",
  "waiting_input",
  "completed",
  "idle",
]);

/**
 * Per-client tracking so {@link onDisconnect} can kill+park each session
 * owned by that client.
 */
interface ClientState {
  readonly sessionIds: Set<string>;
  /** Active forwarders keyed by sessionId (we tear them down on disconnect). */
  readonly forwarders: Map<string, ForwarderState>;
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
      state = { sessionIds: new Set<string>(), forwarders: new Map() };
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

    addSession(session);
    clientState(conn).sessionIds.add(sessionId);

    return {
      jsonrpc: "2.0",
      id: 0,
      result: null,
    } as AhpResponse;
  }

  function handleSubscribe(params: SubscribeParams, conn: AhpServerConnection): AhpResponse {
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
    // if subscribe is called twice for the same channel).
    const prior = cState.forwarders.get(sessionId);
    if (prior !== undefined) {
      prior.cancelled = true;
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
    // Step 1: drain any parked events first.
    const parked = drainParkedSession(sessionId);
    if (parked !== undefined) {
      for (const event of parked) {
        if (forwarder.cancelled) {
          return;
        }
        emitActionsForEvent(conn, sessionId, event, forwarder);
      }
    }
    // Step 2: forward live events from the active session, if any.
    const session = getSession(sessionId);
    if (session === undefined) {
      // Session was parked-only (no live runtime). Forwarder is idle until
      // a reanimate spawns a new one — but reanimate would be a fresh
      // createSession on the same URI, which goes through a different code
      // path. So just return.
      return;
    }
    try {
      for await (const event of session.stream()) {
        if (forwarder.cancelled) {
          return;
        }
        emitActionsForEvent(conn, sessionId, event, forwarder);
      }
    } catch {
      // Internal error — let the session die normally; no parking here.
    } finally {
      // Clean up forwarder map entry.
      const cState = clients.get(conn.clientId);
      if (cState?.forwarders.get(sessionId) === forwarder) {
        cState.forwarders.delete(sessionId);
      }
      // If we exited NOT because of cancellation (natural completion or
      // an internal error), the session has nothing more to emit and the
      // runtime has finished — remove it from the registry and from the
      // owning client's session set so `listSessions` doesn't surface
      // ghost entries and memory doesn't accumulate.
      if (!forwarder.cancelled) {
        removeSession(sessionId);
        cState?.sessionIds.delete(sessionId);
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
        userMessage: { text: "" },
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
      const a = params.action as { userMessage: { text: string } };
      session.sendInput(a.userMessage.text);
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
      session.kill("disposed");
      removeSession(sessionId);
    }
    const cState = clients.get(conn.clientId);
    if (cState !== undefined) {
      cState.sessionIds.delete(sessionId);
      const fwd = cState.forwarders.get(sessionId);
      if (fwd !== undefined) {
        fwd.cancelled = true;
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
      case "running":
        return SessionStatus.InProgress;
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
        default:
          return jsonRpcError(req, JsonRpcErrorCodes.MethodNotFound, `Unknown method: ${method}`);
      }
    },

    onNotification: (notif: AhpNotification, conn: AhpServerConnection): void => {
      if (notif.method === "dispatchAction") {
        handleDispatchAction(notif.params as DispatchActionParams, conn);
      }
      // Other client-dispatchable notifications (unsubscribe, etc.) — no-op
      // for the wire-only scope.
    },

    onDisconnect: (clientId: string): void => {
      const cState = clients.get(clientId);
      if (cState === undefined) {
        return;
      }
      // For each session this client owned, kill + park its events for
      // replay on next subscribe (whoever calls subscribe next, including
      // a reconnecting same-client).
      for (const sessionId of cState.sessionIds) {
        const session = getSession(sessionId);
        if (session !== undefined) {
          session.kill("disconnected");
          const buffered = session.drainBufferedEvents();
          if (buffered.length > 0) {
            parkSession(sessionId, buffered);
          }
          removeSession(sessionId);
        }
        const fwd = cState.forwarders.get(sessionId);
        if (fwd !== undefined) {
          fwd.cancelled = true;
        }
      }
      clients.delete(clientId);
    },
  });

  return ahp;
}
