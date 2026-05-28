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
  ListSessionsResult,
  StateAction,
  URI,
  AhpNotification,
} from "@grackle-ai/ahp";
import { ActionType } from "@grackle-ai/ahp";
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
  ServerActionEnvelope,
} from "./host-transport.js";

const ROOT_CHANNEL = "ahp-root://" as const;

/** Build the AHP session channel URI for a Grackle session id. */
function sessionChannel(sessionId: string): URI {
  return `ahp-session:/${sessionId}`;
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
      userMessage: { text },
    };
    this.socket.notify("dispatchAction", {
      channel: sessionUri,
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
    try {
      await this.socket.request("disposeSession", { channel: sessionUri });
    } finally {
      this.closeSession(sessionUri);
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
    await this.socket.request("createSession", ahpParams);
    await this.socket.request("subscribe", { channel });
    // After subscribe resolves, PowerLine starts firing action notifications
    // (including any replayed parked events) — the handleNotification handler
    // routes them to the session's queue.
  }

  private surfaceErrorAndClose(session: SessionStream, channel: URI, err: unknown): void {
    // Synthesize an error event so the downstream pipeline sees the failure
    // through the same channel it sees normal events.
    const message = err instanceof Error ? err.message : String(err);
    const errorEvent: AgentEventFields = { type: "error", content: message };
    session.queue.push({ event: errorEvent, actions: [] });
    session.queue.push({ event: { type: "status", content: "failed" }, actions: [] });
    this.closeSession(channel);
  }
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
