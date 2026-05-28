/**
 * Per-host AHP supervisor. Wraps a single `AhpClientSocket` with the
 * channel-scoped responsibilities the framing layer deliberately leaves out:
 *
 * - per-(host, channel) `serverSeq` tracking and client-side dedup,
 * - automatic re-subscription on every (re)connect (HR8b ships without the
 *   AHP `reconnect` RPC — every reconnect refetches snapshots; tracked as a
 *   follow-up in [#1344](https://github.com/nick-pape/grackle/issues/1344) /
 *   [#1345](https://github.com/nick-pape/grackle/issues/1345)),
 * - a monotone `generation` counter so consumers can detect stale handles,
 * - a `SessionSummary` cache fed by `listSessions` on connect plus the
 *   `root/session*` notifications.
 *
 * Mirrors the Rust SDK pattern documented in
 * `agent-host-protocol/clients/rust/MULTI_HOST.md`.
 */

import type {
  ActionEnvelope,
  AhpNotification,
  AuthRequiredParams,
  CommandMap,
  ListSessionsResult,
  SessionAddedParams,
  SessionRemovedParams,
  SessionSummary,
  SessionSummaryChangedParams,
  Snapshot,
  SubscribeResult,
  URI,
} from "@grackle-ai/ahp";
import { isClientDispatchable } from "@grackle-ai/ahp";
import {
  AhpClientSocket,
  type AhpConnectionState,
  type ClientIdStore,
} from "@grackle-ai/ahp-transport";

import { AsyncQueue } from "./async-queue.js";
import { GenerationCounter } from "./generation-counter.js";
import { SessionCache } from "./session-cache.js";
import { SubscriptionTracker } from "./subscription-tracker.js";
import type {
  AddHostOptions,
  ClientDispatchableAction,
  HostedSessionSummary,
  SubscriptionMessage,
} from "./types.js";

/** Severity-keyed levels used for OTLP-style telemetry forwarding. */
export type TelemetryStream = "logs" | "traces" | "metrics";

/** Pluggable logger interface (matches the existing `defaultLogger` shape). */
export interface SupervisorLogger {
  debug(msg: unknown, ...args: unknown[]): void;
  info(msg: unknown, ...args: unknown[]): void;
  warn(msg: unknown, ...args: unknown[]): void;
  error(msg: unknown, ...args: unknown[]): void;
}

/** Construction options for {@link HostSupervisor}. */
export interface HostSupervisorOptions {
  /** Host identity and connection details. */
  readonly host: AddHostOptions;
  /** Where the AHP `clientId` is persisted across (re)connects. */
  readonly clientIdStore: ClientIdStore;
  /** Optional logger. */
  readonly logger?: SupervisorLogger;
  /**
   * Optional handler for server→client `auth/required` notifications. HR8b
   * plumbs the slot only; HR8d will register the actual `authenticate`
   * request handler.
   */
  readonly onAuthRequired?: (params: AuthRequiredParams) => void;
  /**
   * Optional handler for `otlp/export*` notifications. HR8b plumbs the slot;
   * downstream consumers (HR8d / the Grackle telemetry plane) wire it.
   */
  readonly onTelemetry?: (stream: TelemetryStream, params: unknown) => void;
}

/** AHP root channel URI (the single static channel; see `@grackle-ai/ahp`). */
const ROOT_CHANNEL = "ahp-root://" as const;

const NOOP_LOGGER: SupervisorLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Per-host supervisor. Created via {@link MultiHostClient.addHost} but
 * exported so advanced consumers can drop down to a single host directly
 * (mirroring Rust's `HostClientHandle`).
 */
export class HostSupervisor {
  private readonly host: AddHostOptions;
  private readonly socket: AhpClientSocket;
  private readonly tracker: SubscriptionTracker = new SubscriptionTracker();
  private readonly cache: SessionCache = new SessionCache();
  private readonly generationCounter: GenerationCounter = new GenerationCounter();
  private readonly logger: SupervisorLogger;
  private readonly onAuthRequired: ((params: AuthRequiredParams) => void) | undefined;
  private readonly onTelemetry: ((stream: TelemetryStream, params: unknown) => void) | undefined;
  private readonly stateListeners: Set<(state: AhpConnectionState) => void> = new Set();

  private nextClientSeq: number = 0;
  private firstOpenPromise: Promise<void> | undefined;
  private firstOpenResolve: ((value: void) => void) | undefined;
  private firstOpenReject: ((err: Error) => void) | undefined;
  private isClosed: boolean = false;

  public constructor(opts: HostSupervisorOptions) {
    this.host = opts.host;
    this.logger = opts.logger ?? NOOP_LOGGER;
    this.onAuthRequired = opts.onAuthRequired;
    this.onTelemetry = opts.onTelemetry;
    this.socket = new AhpClientSocket({
      url: this.host.baseUrl,
      powerlineToken: this.host.powerlineToken,
      clientIdStore: opts.clientIdStore,
      clientIdKey: this.host.environmentId,
      ...(this.host.locale !== undefined ? { locale: this.host.locale } : {}),
      onNotification: (n) => this.handleNotification(n),
      onStateChange: (s) => this.handleStateChange(s),
    });
  }

  // ─── Public API ───────────────────────────────────────────────────

  /** Stable identifier passed in at construction time. */
  public get environmentId(): string {
    return this.host.environmentId;
  }

  /** Current connection state from the underlying socket. */
  public get state(): AhpConnectionState {
    return this.socket.state;
  }

  /** Current generation counter (bumped on every successful (re)connect). */
  public generation(): number {
    return this.generationCounter.current();
  }

  /** Cached session summaries last refreshed via `listSessions`/notifications. */
  public listSessionSummaries(): SessionSummary[] {
    return this.cache.list();
  }

  /**
   * Open the socket and run the initial connect path (initialize → refresh
   * sessions → bump generation). Resolves once the host is connected and
   * the session cache has been populated. Reconnects are handled
   * automatically afterwards.
   */
  public async open(): Promise<void> {
    if (this.firstOpenPromise !== undefined) {
      return this.firstOpenPromise;
    }
    this.firstOpenPromise = new Promise<void>((resolve, reject) => {
      this.firstOpenResolve = resolve;
      this.firstOpenReject = reject;
    });
    this.socket.open().catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.firstOpenReject?.(error);
    });
    return this.firstOpenPromise;
  }

  /**
   * Pass-through typed request. Queues during reconnect (the underlying
   * socket handles that); rejects after `close()`.
   */
  public request<M extends keyof CommandMap>(
    method: M,
    params: CommandMap[M]["params"],
  ): Promise<CommandMap[M]["result"]> {
    return this.socket.request(method, params);
  }

  /**
   * Subscribe to a channel. Returns an `AsyncIterable` of
   * {@link SubscriptionMessage} that yields a leading `snapshot` element
   * (when the channel is stateful), then `action` envelopes as they arrive,
   * then closes (`done: true`) when the consumer breaks, `close()` is
   * called, or the channel is reported unavailable. `fromServerSeq` filters
   * `action` events at the queue boundary so consumers restoring local
   * state can skip envelopes they already have.
   *
   * Note: only the first subscriber per channel receives a snapshot
   * (delivered as the initial yield). Late-arriving subscribers see actions
   * from the moment they attach; the caller is responsible for any external
   * snapshot bootstrap they may need.
   */
  public subscribe(channel: URI, fromServerSeq?: number): AsyncIterable<SubscriptionMessage> {
    const queue = new AsyncQueue<SubscriptionMessage>();
    const isFirst = this.tracker.ensure(channel);
    this.tracker.addSubscriber(channel, queue);

    if (isFirst && this.socket.state === "open") {
      void this.issueSubscribeRpc(channel);
    }

    const cleanup = (): void => {
      const wasLast = this.tracker.removeSubscriber(channel, queue);
      queue.close();
      if (wasLast) {
        this.tracker.drop(channel);
        if (this.socket.state === "open") {
          this.socket.notify("unsubscribe", { channel });
        }
      }
    };

    return {
      [Symbol.asyncIterator]: (): AsyncIterableIterator<SubscriptionMessage> => {
        const iter = (async function* (): AsyncGenerator<SubscriptionMessage> {
          try {
            for await (const msg of queue) {
              if (
                fromServerSeq !== undefined &&
                msg.kind === "action" &&
                msg.serverSeq <= fromServerSeq
              ) {
                continue;
              }
              yield msg;
            }
          } finally {
            cleanup();
          }
        })();
        return iter;
      },
    };
  }

  /**
   * Send a client-dispatchable action. Throws synchronously if the action
   * is not in the AHP spec's client-dispatchable set; otherwise fires a
   * `dispatchAction` notification with a monotone per-host `clientSeq`.
   */
  public dispatchAction(channel: URI, action: ClientDispatchableAction): void {
    if (!isClientDispatchable(action)) {
      throw new Error(
        `dispatchAction: action type '${action.type}' is not client-dispatchable per AHP spec`,
      );
    }
    this.nextClientSeq += 1;
    this.socket.notify("dispatchAction", {
      channel,
      clientSeq: this.nextClientSeq,
      action,
    });
  }

  /** Register a state-change listener. Returns an unsubscribe function. */
  public onStateChange(listener: (state: AhpConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Close the socket, terminate every subscriber's `AsyncIterable` with an
   * `unavailable` sentinel, and refuse further public calls. Idempotent.
   */
  public async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    // Surface "unavailable" to every open subscriber before tearing down.
    for (const channel of this.tracker.activeChannels()) {
      this.fanoutUnavailable(channel, "supervisor closed");
    }
    this.tracker.clear();
    await this.socket.close();
    if (this.firstOpenReject !== undefined && this.firstOpenResolve !== undefined) {
      // Surface close() during in-flight open() as a rejection.
      this.firstOpenReject(new Error("HostSupervisor closed before first open completed"));
      this.firstOpenReject = undefined;
      this.firstOpenResolve = undefined;
    }
  }

  // ─── Internals ────────────────────────────────────────────────────

  /** Fan a synthetic {@link HostedSessionSummary} list to the multi-host facade. */
  public hostedSessionSummaries(): HostedSessionSummary[] {
    return this.cache.list().map((summary) => ({
      environmentId: this.host.environmentId,
      summary,
    }));
  }

  private handleStateChange(state: AhpConnectionState): void {
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch (err) {
        this.logger.warn({ err }, "state change listener threw");
      }
    }
    if (state === "open") {
      // Fire-and-forget — connect-path errors are logged but don't take
      // down the supervisor; the socket will retry on its own if the wire
      // drops, and listSessions/subscribe errors are recoverable.
      void this.runOpenPath();
    } else if (state === "closed" && !this.isClosed) {
      // Auth-rejected or initial-handshake failure: socket is gone, but
      // the supervisor was not closed by us. Surface the unavailability.
      for (const channel of this.tracker.activeChannels()) {
        this.fanoutUnavailable(channel, "host disconnected");
      }
      this.tracker.clear();
      if (this.firstOpenReject !== undefined) {
        this.firstOpenReject(new Error(`HostSupervisor '${this.host.environmentId}' closed`));
        this.firstOpenReject = undefined;
        this.firstOpenResolve = undefined;
      }
    }
  }

  private async runOpenPath(): Promise<void> {
    this.generationCounter.bump();
    try {
      await this.refreshSessions();
    } catch (err) {
      this.logger.warn(
        { err, environmentId: this.host.environmentId },
        "initial listSessions failed; session cache unchanged",
      );
    }
    for (const channel of this.tracker.activeChannels()) {
      void this.issueSubscribeRpc(channel);
    }
    // First-open caller resolves once the open-path has primed the cache.
    if (this.firstOpenResolve !== undefined) {
      this.firstOpenResolve();
      this.firstOpenResolve = undefined;
      this.firstOpenReject = undefined;
    }
  }

  private async refreshSessions(): Promise<void> {
    const result: ListSessionsResult = await this.socket.request("listSessions", {
      channel: ROOT_CHANNEL,
    });
    this.cache.replaceAll(result.items);
  }

  private async issueSubscribeRpc(channel: URI): Promise<void> {
    let result: SubscribeResult;
    try {
      result = await this.socket.request("subscribe", { channel });
    } catch (err) {
      this.logger.warn(
        { err, environmentId: this.host.environmentId, channel },
        "subscribe RPC failed; closing subscribers for this channel",
      );
      this.fanoutUnavailable(channel, "subscribe RPC failed");
      this.tracker.drop(channel);
      return;
    }
    if (result.snapshot !== undefined) {
      this.fanoutSnapshot(channel, result.snapshot);
    }
  }

  private fanoutSnapshot(channel: URI, snapshot: Snapshot): void {
    this.tracker.reset(channel, snapshot.fromSeq);
    const msg: SubscriptionMessage = {
      kind: "snapshot",
      serverSeq: snapshot.fromSeq,
      snapshot,
    };
    for (const q of this.tracker.subscribers(channel)) {
      q.push(msg);
    }
  }

  private fanoutUnavailable(channel: URI, reason: string): void {
    const msg: SubscriptionMessage = {
      kind: "unavailable",
      serverSeq: this.tracker.lastSeq(channel),
      reason,
    };
    for (const q of this.tracker.subscribers(channel)) {
      q.push(msg);
      q.close();
    }
  }

  private handleNotification(n: AhpNotification): void {
    switch (n.method) {
      case "action": {
        const env = n.params as ActionEnvelope;
        if (this.tracker.shouldApply(env.channel, env.serverSeq)) {
          this.tracker.recordApplied(env.channel, env.serverSeq);
          const msg: SubscriptionMessage = {
            kind: "action",
            serverSeq: env.serverSeq,
            action: env.action,
            ...(env.origin !== undefined ? { origin: env.origin } : {}),
          };
          for (const q of this.tracker.subscribers(env.channel)) {
            q.push(msg);
          }
        }
        return;
      }
      case "root/sessionAdded": {
        const p = n.params as SessionAddedParams;
        this.cache.add(p.summary.resource, p.summary);
        return;
      }
      case "root/sessionRemoved": {
        const p = n.params as SessionRemovedParams;
        this.cache.remove(p.session);
        return;
      }
      case "root/sessionSummaryChanged": {
        const p = n.params as SessionSummaryChangedParams;
        this.cache.applyChanges(p.session, p.changes);
        return;
      }
      case "auth/required": {
        this.onAuthRequired?.(n.params as AuthRequiredParams);
        return;
      }
      case "otlp/exportLogs": {
        this.onTelemetry?.("logs", n.params);
        return;
      }
      case "otlp/exportTraces": {
        this.onTelemetry?.("traces", n.params);
        return;
      }
      case "otlp/exportMetrics": {
        this.onTelemetry?.("metrics", n.params);
        return;
      }
      default:
        this.logger.debug(
          { method: n.method, environmentId: this.host.environmentId },
          "unhandled inbound notification",
        );
    }
  }
}
