/**
 * Public types shared across `ahp-client/` modules. Re-exported from
 * `index.ts`; some types are also returned from the per-host
 * {@link HostSupervisor} surface.
 */

import type {
  ActionEnvelope,
  RootConfigChangedAction,
  SessionInputAnswerChangedAction,
  SessionInputCompletedAction,
  SessionQueuedMessagesReorderedAction,
  SessionTurnCancelledAction,
  SessionTurnStartedAction,
  SessionToolCallApprovedAction,
  SessionToolCallDeniedAction,
  SessionToolCallResultConfirmedAction,
  SessionIsReadChangedAction,
  SessionIsArchivedChangedAction,
  SessionMetaChangedAction,
  TerminalInputAction,
  ChangesetOperationsChangedAction,
  SessionSummary,
  Snapshot,
  StateAction,
} from "@grackle-ai/ahp";

/**
 * The narrow set of `StateAction`s that a client may send via
 * `dispatchAction`. Mirrors `IS_CLIENT_DISPATCHABLE` in
 * `@grackle-ai/ahp`'s vendored `action-origin.generated.ts`; runtime-checked
 * via `isClientDispatchable` at the dispatch boundary.
 */
export type ClientDispatchableAction =
  | RootConfigChangedAction
  | SessionTurnStartedAction
  | SessionToolCallApprovedAction
  | SessionToolCallDeniedAction
  | SessionToolCallResultConfirmedAction
  | SessionTurnCancelledAction
  | SessionInputAnswerChangedAction
  | SessionInputCompletedAction
  | SessionQueuedMessagesReorderedAction
  | SessionIsReadChangedAction
  | SessionIsArchivedChangedAction
  | SessionMetaChangedAction
  | TerminalInputAction
  | ChangesetOperationsChangedAction;

/** Options accepted by {@link MultiHostClient.addHost}. */
export interface AddHostOptions {
  /** Stable identifier for this host across the session. */
  readonly environmentId: string;
  /** Full WebSocket URL of the host (e.g. `ws://127.0.0.1:7433/ahp`). */
  readonly baseUrl: string;
  /** Bearer token sent on the HTTP upgrade. */
  readonly powerlineToken: string;
  /** Optional IETF BCP 47 locale tag forwarded to the host. */
  readonly locale?: string;
}

/**
 * One element yielded by the `AsyncIterable` returned from
 * {@link MultiHostClient.subscribe}. The three-variant discriminated union
 * mirrors the Rust SDK's `HostSubscriptionEvent` and lets consumers handle
 * the post-reconnect snapshot baseline reset in-band rather than via a side
 * channel.
 */
export type SubscriptionMessage =
  | {
      readonly kind: "snapshot";
      /** `serverSeq` at which the snapshot was taken (matches `snapshot.fromSeq`). */
      readonly serverSeq: number;
      readonly snapshot: Snapshot;
    }
  | {
      readonly kind: "action";
      readonly serverSeq: number;
      readonly action: StateAction;
      /** The envelope's `origin`, when present. */
      readonly origin?: ActionEnvelope["origin"];
    }
  | {
      /** Channel was dropped (e.g. session disposed, server reported missing on reconnect). */
      readonly kind: "unavailable";
      readonly serverSeq: number;
      readonly reason: string;
    };

/**
 * One row of the cross-host aggregated session view. Returned by
 * {@link MultiHostClient.aggregatedSessions}.
 */
export interface HostedSessionSummary {
  /** The host this session belongs to (matches {@link AddHostOptions.environmentId}). */
  readonly environmentId: string;
  /** The session summary as cached on that host. */
  readonly summary: SessionSummary;
}
