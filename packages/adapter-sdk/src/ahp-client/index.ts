/**
 * `@grackle-ai/adapter-sdk/ahp-client` — Node port of the Rust SDK's
 * `MultiHostClient` (see `agent-host-protocol/clients/rust/MULTI_HOST.md`).
 *
 * Wraps `AhpClientSocket` (from `@grackle-ai/ahp-transport`) with the
 * per-host channel-scoped responsibilities that the framing layer
 * deliberately leaves out:
 *
 * - per-(host, channel) `serverSeq` tracking and client-side dedup,
 * - automatic re-subscription on every (re)connect,
 * - a monotone `generation` counter so consumers can detect stale handles,
 * - a `SessionSummary` cache kept fresh by `listSessions` + `root/session*`
 *   notifications.
 *
 * See HR8 epic [#1291](https://github.com/nick-pape/grackle/issues/1291)
 * and HR8b ticket [#1334](https://github.com/nick-pape/grackle/issues/1334).
 *
 * @packageDocumentation
 */

export { MultiHostClient } from "./multi-host-client.js";
export type { MultiHostClientOptions } from "./multi-host-client.js";

export { HostSupervisor } from "./host-supervisor.js";
export type {
  HostSupervisorOptions,
  SupervisorLogger,
  TelemetryStream,
} from "./host-supervisor.js";

export type {
  AddHostOptions,
  ClientDispatchableAction,
  HostedSessionSummary,
  SubscriptionMessage,
} from "./types.js";
