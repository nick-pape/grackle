/**
 * AHP-backed implementation of {@link IHostTransport} (AHP HR8d / #1336).
 *
 * Owns one `AhpClientSocket` per `PowerLineConnection` and routes
 * inbound `action` notifications to per-session queues via the
 * {@link reverseMapAction} reverse mapper. Downstream consumers in
 * `@grackle-ai/core` continue to read `envelope.event` (the synthesized
 * AgentEventFields), so no consumer code changes — only the wire format does.
 *
 * Wire-protocol summary (per #1336):
 *
 * - `createSession` (spawn) → AHP `createSession` + `subscribe`
 * - `createSession` (reanimate) → same, with `config.resumeFromRuntimeSessionId`
 * - `dispatchInput` → AHP `dispatchAction` notification with `SessionTurnStartedAction`
 * - `dispose` (kill) → AHP `disposeSession`
 * - `listSessions` → AHP `listSessions`
 * - `authenticate` → AHP `authenticate`
 *
 * Drain semantics (Option E): PowerLine replays parked events as `action`
 * notifications immediately after the `subscribe` response, so the consumer
 * receives them via the same stream — no separate `drainBuffered` RPC.
 *
 * @module ahp-host-transport
 */

import type {
  ActionEnvelope,
  CreateSessionParams as AhpCreateSessionParams,
  ContentEncoding,
  CreateResourceWatchResult,
  ListSessionsResult,
  ResourceListResult,
  ResourceReadResult,
  ResourceWatchChangedAction,
  StateAction,
  URI,
  AhpNotification,
} from "@grackle-ai/ahp";
import { ActionType, MessageKind } from "@grackle-ai/ahp";
import {
  type AgentEventFields,
  newReverseMapperContext,
  reverseMapAction,
  type ReverseMapperContext,
} from "@grackle-ai/common";
import { AhpClientSocket } from "@grackle-ai/ahp-transport";

import type {
  AuthenticateParams,
  CreateSessionParams,
  CreateSessionResult,
  HostSessionInfo,
  IHostTransport,
  ReanimateParams,
  ResourceWatchListener,
  ResourceWatchOptions,
  ResourceWatchSubscription,
  ServerActionEnvelope,
} from "./host-transport.js";

const ROOT_CHANNEL = "ahp-root://" as const;
const SESSION_CHANNEL_PREFIX = "ahp-session:/";

/** Build the AHP session channel URI for a Grackle session id. */
function sessionChannel(sessionId: string): URI {
  return `${SESSION_CHANNEL_PREFIX}${sessionId}`;
}

/**
 * Accept either a plain Grackle session id (e.g. `"sess-1"`) or an
 * already-formed AHP session URI (`"ahp-session:/sess-1"`) and return the
 * URI form. `IHostTransport`'s `dispatchInput` / `dispose` historically
 * pass a session id; this helper keeps the boundary forgiving.
 */
function toSessionChannel(sessionIdOrUri: string): URI {
  return sessionIdOrUri.startsWith(SESSION_CHANNEL_PREFIX)
    ? sessionIdOrUri
    : sessionChannel(sessionIdOrUri);
}

/**
 * Minimal push/pull queue specialized for per-session envelope streaming.
 * Mirrors `packages/runtime-sdk/src/async-queue.ts:1-48`; inlined here to
 * avoid a new dep edge on runtime-sdk.
 *
 * @internal
 */
class EnvelopeQueue {
  private readonly buffer: ServerActionEnvelope[] = [];
  private readonly waiters: Array<(value: ServerActionEnvelope | undefined) => void> = [];
  private closedFlag: boolean = false;

  public push(item: ServerActionEnvelope): void {
    if (this.closedFlag) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter(item);
      return;
    }
    this.buffer.push(item);
  }

  public async shift(): Promise<ServerActionEnvelope | undefined> {
    const buffered = this.buffer.shift();
    if (buffered !== undefined) {
      return buffered;
    }
    if (this.closedFlag) {
      return undefined;
    }
    return new Promise<ServerActionEnvelope | undefined>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  public close(): void {
    if (this.closedFlag) {
      return;
    }
    this.closedFlag = true;
    for (const waiter of this.waiters) {
      waiter(undefined);
    }
    this.waiters.length = 0;
  }

  public get closed(): boolean {
    return this.closedFlag;
  }

  public async *[Symbol.asyncIterator](): AsyncIterableIterator<ServerActionEnvelope> {
    while (true) {
      const item = await this.shift();
      if (item === undefined) {
        return;
      }
      yield item;
    }
  }
}

/**
 * Per-session router state.
 *
 * @internal
 */
interface SessionStream {
  readonly queue: EnvelopeQueue;
  readonly context: ReverseMapperContext;
}

/**
 * AHP-backed {@link IHostTransport} for a single environment.
 *
 * Lifecycle: one instance per `PowerLineConnection`. Owns one
 * `AhpClientSocket`; multiplexes session subscriptions over it.
 *
 * Construct via {@link createAhpHostTransport} (in `./connect.ts`) which
 * handles the `socket.open()` handshake. Tests can construct directly with
 * a pre-opened socket.
 */
export class AhpHostTransport implements IHostTransport {
  private readonly socket: AhpClientSocket;
  private readonly sessions: Map<URI, SessionStream> = new Map();
  /**
   * Active resource-watch listeners keyed by their `ahp-resource-watch:/<id>`
   * channel. Populated by {@link AhpHostTransport.createResourceWatch}; consulted by
   * {@link AhpHostTransport.handleNotification} to route `resourceWatch/changed` action batches.
   */
  private readonly resourceWatchers: Map<URI, ResourceWatchListener> = new Map();
  private nextClientSeq: number = 0;

  /**
   * Construct an AhpHostTransport over a pre-opened `AhpClientSocket`.
   * The socket MUST already have completed its `initialize` handshake.
   *
   * @param socket - The AHP client socket, opened and connected.
   */
  public constructor(socket: AhpClientSocket) {
    this.socket = socket;
  }

  /**
   * Notification handler that must be supplied to `AhpClientSocket` at
   * construction time (the socket's `onNotification` option). This is a
   * static-bound method so it can be passed to the socket constructor.
   *
   * Routes inbound `action` notifications to the appropriate per-session
   * queue, running the reverse mapper to synthesize `AgentEventFields` and
   * wrapping each into a `ServerActionEnvelope`. Other notification methods
   * are ignored (no consumers in the wire-only scope of HR8d).
   *
   * @param notif - The AHP notification from the wire.
   */
  public handleNotification(notif: AhpNotification): void {
    if (notif.method !== "action") {
      // Other notifications (root/sessionAdded, auth/required, otlp/*, etc.)
      // are not consumed by Grackle's downstream pipeline; drop silently.
      return;
    }
    const envelope = notif.params as ActionEnvelope;
    // Resource-watch change batches arrive as `action` notifications on a
    // `ahp-resource-watch:/<id>` channel (not a session channel). Route them to
    // the registered watch listener before the session lookup.
    if (envelope.action.type === ActionType.ResourceWatchChanged) {
      const listener = this.resourceWatchers.get(envelope.channel);
      if (listener !== undefined) {
        const { changes } = envelope.action as ResourceWatchChangedAction;
        listener(changes.items);
      }
      return;
    }
    const session = this.sessions.get(envelope.channel);
    if (session === undefined) {
      return;
    }
    const result = reverseMapAction(envelope, session.context);
    for (const event of result.events) {
      session.queue.push({ event, actions: [envelope.action] });
    }
  }

  /**
   * Create a new session via AHP `createSession` + `subscribe`.
   *
   * Returns synchronously with the session URI and the live envelope stream.
   * The actual AHP requests fire in the background; failures push an error
   * sentinel into the stream and close it (mirroring how gRPC stream errors
   * surface during iteration).
   */
  public createSession(params: CreateSessionParams): CreateSessionResult {
    const channel = sessionChannel(params.sessionId);
    const session = this.getOrCreateSession(channel);
    void this.runSpawnFlow(channel, params, undefined).catch((err: unknown) => {
      this.surfaceErrorAndClose(session, channel, err);
    });
    return { sessionUri: channel, stream: session.queue };
  }

  /**
   * Reanimate a suspended session. Maps to AHP `createSession` with a
   * `config.resumeFromRuntimeSessionId` hint that PowerLine interprets as
   * "spawn a continuation runtime from this prior runtime session."
   */
  public reanimate(params: ReanimateParams): AsyncIterable<ServerActionEnvelope> {
    const channel = sessionChannel(params.sessionId);
    const session = this.getOrCreateSession(channel);
    const reanimateConfig: CreateSessionParams = {
      sessionId: params.sessionId,
      runtime: params.runtime,
      // Reanimate doesn't have prompt/model/etc.; use empty defaults — the
      // PowerLine handler ignores them when resumeFromRuntimeSessionId is set.
      prompt: "",
      model: "",
      maxTurns: 0,
      branch: "",
      workingDirectory: "",
      systemContext: "",
      taskId: "",
      mcpServersJson: "",
      mcpUrl: "",
      mcpToken: "",
    };
    void this.runSpawnFlow(channel, reanimateConfig, params.runtimeSessionId).catch(
      (err: unknown) => {
        this.surfaceErrorAndClose(session, channel, err);
      },
    );
    return session.queue;
  }

  /** Send input text by dispatching a `SessionTurnStartedAction`. */
  public async dispatchInput(sessionUri: string, text: string): Promise<void> {
    this.nextClientSeq += 1;
    const action: StateAction = {
      type: ActionType.SessionTurnStarted,
      turnId: `turn-input-${String(this.nextClientSeq)}`,
      message: { text, origin: { kind: MessageKind.User } },
    };
    this.socket.notify("dispatchAction", {
      channel: toSessionChannel(sessionUri),
      clientSeq: this.nextClientSeq,
      action,
    });
  }

  /**
   * Deliver runtime credentials.
   *
   * AHP `authenticate` is OAuth-shaped (single `{ resource, token }`) and
   * Grackle's HR6 authenticate delivers multiple typed tokens (env-var or
   * file-backed) for one provider. HR8d preserves the AHP-spec wire method
   * by fanning Grackle's tokens out into N `authenticate` calls. Each call:
   *
   * - `resource`: `grackle://provider/{provider}/{name}` — encodes the
   *   Grackle-side identity. PowerLine recognizes the `grackle://` scheme
   *   and decodes it.
   * - `token`: JSON-encoded `{ type, envVar?, filePath?, value }` — carries
   *   the delivery instructions inside the AHP token field.
   *
   * On-spec method, abused field semantics. The contortion is documented in
   * #1336 and bounded to this single command.
   */
  public async authenticate(params: AuthenticateParams): Promise<void> {
    const settlements = await Promise.allSettled(
      params.tokens.map((t) =>
        this.socket.request("authenticate", {
          channel: ROOT_CHANNEL,
          resource: `grackle://provider/${params.provider}/${t.name}`,
          token: JSON.stringify({
            type: t.type,
            envVar: t.envVar,
            filePath: t.filePath,
            value: t.value,
          }),
        }),
      ),
    );
    // Surface the first failure (if any) so the caller can log it — matches
    // the prior gRPC-path "best-effort, log and continue" semantics.
    const rejection = settlements.find((s) => s.status === "rejected");
    if (rejection !== undefined && rejection.status === "rejected") {
      throw rejection.reason as Error;
    }
  }

  /**
   * Dispose a session via AHP `disposeSession`.
   *
   * AHP's `DisposeSessionParams` doesn't carry a `reason` field; the optional
   * `reason` argument is logged client-side but not delivered to PowerLine.
   * Acceptable for HR8d — `reason` was informational in the gRPC path too.
   */
  public async dispose(sessionUri: string, _reason?: string): Promise<void> {
    const channel = toSessionChannel(sessionUri);
    try {
      await this.socket.request("disposeSession", { channel });
    } finally {
      this.closeSession(channel);
    }
  }

  /** List active sessions via AHP `listSessions`. */
  public async listSessions(): Promise<HostSessionInfo[]> {
    const result = (await this.socket.request("listSessions", {
      channel: ROOT_CHANNEL,
    })) as ListSessionsResult;
    return result.items.map((s) => ({
      sessionId: s.resource.replace(/^ahp-session:\//, ""),
      runtime: s.provider,
      // SessionStatus is a bitset enum; preserve the numeric value as string
      // so existing consumers (which treat status as opaque) still work.
      status: String(s.status),
    }));
  }

  /** Read a file's content via AHP `resourceRead`. */
  public async resourceRead(uri: string, encoding?: ContentEncoding): Promise<ResourceReadResult> {
    return this.socket.request("resourceRead", {
      channel: ROOT_CHANNEL,
      uri,
      ...(encoding !== undefined ? { encoding } : {}),
    });
  }

  /** List a directory's entries via AHP `resourceList`. */
  public async resourceList(uri: string): Promise<ResourceListResult> {
    return this.socket.request("resourceList", { channel: ROOT_CHANNEL, uri });
  }

  /**
   * Start a watch via AHP `createResourceWatch` then `subscribe` to the
   * returned watch channel. The listener is registered BEFORE `subscribe` so no
   * change batch can race ahead of it. The watcher uses `ignoreInitial`, so no
   * synthetic events fire for existing files at subscribe time.
   */
  public async createResourceWatch(
    options: ResourceWatchOptions,
    onChange: ResourceWatchListener,
  ): Promise<ResourceWatchSubscription> {
    const { channel } = (await this.socket.request("createResourceWatch", {
      channel: ROOT_CHANNEL,
      uri: options.uri,
      ...(options.recursive !== undefined ? { recursive: options.recursive } : {}),
    })) as CreateResourceWatchResult;
    this.resourceWatchers.set(channel, onChange);
    try {
      await this.socket.request("subscribe", { channel });
    } catch (err) {
      // Subscribe failed after the host allocated the watch entry — drop the
      // local listener AND tell the host to release its watcher, otherwise it
      // leaks until the whole AHP connection disconnects.
      this.resourceWatchers.delete(channel);
      this.socket.notify("unsubscribe", { channel });
      throw err;
    }
    let closed = false;
    return {
      channel,
      close: async (): Promise<void> => {
        if (closed) {
          return;
        }
        closed = true;
        this.resourceWatchers.delete(channel);
        // `unsubscribe` is a fire-and-forget notification on the wire; the host
        // tears the watcher down on receipt (or on disconnect).
        this.socket.notify("unsubscribe", { channel });
      },
    };
  }

  // ─── Internals ────────────────────────────────────────────────────

  private getOrCreateSession(channel: URI): SessionStream {
    let session = this.sessions.get(channel);
    if (session === undefined) {
      session = { queue: new EnvelopeQueue(), context: newReverseMapperContext() };
      this.sessions.set(channel, session);
    }
    return session;
  }

  private closeSession(channel: URI): void {
    const session = this.sessions.get(channel);
    if (session === undefined) {
      return;
    }
    session.queue.close();
    this.sessions.delete(channel);
  }

  private async runSpawnFlow(
    channel: URI,
    params: CreateSessionParams,
    resumeFromRuntimeSessionId: string | undefined,
  ): Promise<void> {
    const config: Record<string, unknown> = {
      // Grackle-specific session config — PowerLine handler validates this shape.
      prompt: params.prompt,
      model: params.model,
      maxTurns: params.maxTurns,
      branch: params.branch,
      workingDirectory: params.workingDirectory,
      systemContext: params.systemContext,
      taskId: params.taskId,
      mcpServersJson: params.mcpServersJson,
      mcpUrl: params.mcpUrl,
      mcpToken: params.mcpToken,
      ...(params.workspaceId !== undefined ? { workspaceId: params.workspaceId } : {}),
      ...(params.useWorktrees !== undefined ? { useWorktrees: params.useWorktrees } : {}),
      ...(params.pipe !== undefined && params.pipe !== "" ? { pipe: params.pipe } : {}),
      ...(params.scriptContent !== undefined && params.scriptContent !== ""
        ? { scriptContent: params.scriptContent }
        : {}),
      ...(resumeFromRuntimeSessionId !== undefined ? { resumeFromRuntimeSessionId } : {}),
    };
    const ahpParams: AhpCreateSessionParams = {
      channel,
      provider: params.runtime,
      config,
    };
    const isReanimate = resumeFromRuntimeSessionId !== undefined;
    try {
      await this.socket.request("createSession", ahpParams);
    } catch (err) {
      // Reanimate path: if the channel is already live on PowerLine (env was
      // never actually torn down — happens with the local adapter whose
      // `stop()` is a no-op), the server returns "Session already active".
      // For reanimate that's success: the underlying runtime never died, we
      // just need to re-subscribe to its action stream.
      if (isReanimate && isSessionAlreadyActiveError(err)) {
        // intentional fall-through to subscribe()
      } else {
        throw err;
      }
    }
    await this.socket.request("subscribe", { channel });
    // After subscribe resolves, PowerLine starts firing action notifications
    // (including any replayed parked events) — the handleNotification handler
    // routes them to the session's queue.
  }

  private surfaceErrorAndClose(session: SessionStream, channel: URI, err: unknown): void {
    // Synthesize an error event so the downstream pipeline sees the failure
    // through the same channel it sees normal events.
    const message = formatTransportError(err);
    const errorEvent: AgentEventFields = { type: "error", content: message };
    session.queue.push({ event: errorEvent, actions: [] });
    session.queue.push({ event: { type: "status", content: "failed" }, actions: [] });
    this.closeSession(channel);
  }
}

/**
 * True if `err` is the JSON-RPC "Session already active" error PowerLine
 * returns when `createSession` targets a channel whose underlying session
 * is still live in the registry. Tested with both message-prefix and
 * code+message-shape since the error can arrive as a rejected
 * `TransportError` or a raw JSON-RPC error object depending on the
 * `request()` path.
 */
function isSessionAlreadyActiveError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : err !== null &&
          typeof err === "object" &&
          typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : "";
  return message.startsWith("Session already active");
}

/**
 * Stringify an unknown error into a readable message for the synthesized
 * `type: "error"` event surfaced into the downstream pipeline.
 *
 * Handles four shapes:
 * - `Error` (and subclasses, including `TransportError` from
 *   `@grackle-ai/ahp-transport`): use `.message`.
 * - JSON-RPC error object `{ code, message }` (what `request()` rejects with
 *   on a server-returned error): use `.message`, prefix with code if present.
 *   Without this branch, `String(err)` returns `"[object Object]"` and the
 *   UI renders an opaque "Error: [object Object]" with no diagnostic value.
 * - String: pass through.
 * - Anything else: best-effort `String(err)`.
 */
function formatTransportError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (err !== null && typeof err === "object") {
    const obj = err as { message?: unknown; code?: unknown };
    if (typeof obj.message === "string" && obj.message.length > 0) {
      return typeof obj.code === "number" || typeof obj.code === "string"
        ? `JSON-RPC error ${String(obj.code)}: ${obj.message}`
        : obj.message;
    }
  }
  return String(err);
}

/**
 * Helper to wire {@link AhpHostTransport}'s notification handler into an
 * `AhpClientSocket` at construction time. The transport's
 * {@link AhpHostTransport.handleNotification} method must be bound to the
 * socket BEFORE `socket.open()` so the first inbound `action` notifications
 * are routed correctly.
 *
 * @param transport - The transport whose handler should be bound.
 * @returns A function suitable for passing as `onNotification` to
 *   `AhpClientSocket`'s constructor options.
 */
export function bindNotificationHandler(transport: AhpHostTransport): (n: AhpNotification) => void {
  return (n) => transport.handleNotification(n);
}
