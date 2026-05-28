/**
 * Per-(host, channel) subscription bookkeeping for a single
 * {@link HostSupervisor}. Tracks:
 *
 * - the highest `serverSeq` applied per channel (for client-side dedup on
 *   replay overlap),
 * - the set of active subscriber queues per channel (for fan-out),
 * - the set of channels the supervisor must re-subscribe to on reconnect.
 *
 * Does NOT issue any RPCs or talk to the wire — pure bookkeeping. The
 * supervisor wraps this with the actual `subscribe`/`unsubscribe`
 * notifications.
 */

import type { URI } from "@grackle-ai/ahp";

import type { AsyncQueue } from "./async-queue.js";
import type { SubscriptionMessage } from "./types.js";

interface ChannelEntry {
  lastServerSeq: number;
  readonly subscribers: Set<AsyncQueue<SubscriptionMessage>>;
}

/**
 * Per-(host, channel) state.
 *
 * @internal
 */
export class SubscriptionTracker {
  private readonly channels: Map<URI, ChannelEntry> = new Map();

  /** True iff at least one consumer has subscribed to `channel` and not yet dropped. */
  public has(channel: URI): boolean {
    return this.channels.has(channel);
  }

  /** Snapshot of currently subscribed channels. */
  public activeChannels(): URI[] {
    return [...this.channels.keys()];
  }

  /**
   * Mark `channel` as subscribed if not already. Returns true on first
   * subscribe (the supervisor must then issue the `subscribe` RPC); false
   * on subsequent calls (caller attaches to the existing entry).
   */
  public ensure(channel: URI): boolean {
    if (this.channels.has(channel)) {
      return false;
    }
    this.channels.set(channel, { lastServerSeq: 0, subscribers: new Set() });
    return true;
  }

  /** Add a subscriber queue. The queue MUST be removed via {@link removeSubscriber} when done. */
  public addSubscriber(channel: URI, queue: AsyncQueue<SubscriptionMessage>): void {
    const entry = this.channels.get(channel);
    if (entry === undefined) {
      throw new Error(`addSubscriber: channel '${channel}' is not subscribed`);
    }
    entry.subscribers.add(queue);
  }

  /**
   * Remove a subscriber queue. Returns true iff `channel` now has zero
   * subscribers (the supervisor must then issue `unsubscribe` and drop the
   * entry via {@link drop}).
   */
  public removeSubscriber(channel: URI, queue: AsyncQueue<SubscriptionMessage>): boolean {
    const entry = this.channels.get(channel);
    if (entry === undefined) {
      return false;
    }
    entry.subscribers.delete(queue);
    return entry.subscribers.size === 0;
  }

  /** All subscriber queues currently attached to `channel`. Empty iterable if none. */
  public subscribers(channel: URI): ReadonlySet<AsyncQueue<SubscriptionMessage>> {
    return this.channels.get(channel)?.subscribers ?? EMPTY_SUBS;
  }

  /** Highest applied `serverSeq` for `channel`, or 0 if unknown. */
  public lastSeq(channel: URI): number {
    return this.channels.get(channel)?.lastServerSeq ?? 0;
  }

  /**
   * Monotone bump of the per-channel `lastServerSeq`. Does NOT go backward.
   * No-op if `channel` is not subscribed.
   */
  public recordApplied(channel: URI, serverSeq: number): void {
    const entry = this.channels.get(channel);
    if (entry === undefined) {
      return;
    }
    if (serverSeq > entry.lastServerSeq) {
      entry.lastServerSeq = serverSeq;
    }
  }

  /**
   * Unconditional reset of the per-channel `lastServerSeq` (used on
   * snapshot delivery, where `snapshot.fromSeq` is the new baseline).
   */
  public reset(channel: URI, newLastSeq: number): void {
    const entry = this.channels.get(channel);
    if (entry === undefined) {
      return;
    }
    entry.lastServerSeq = newLastSeq;
  }

  /**
   * Returns true iff an action with `serverSeq` should be applied — i.e.
   * the channel is subscribed AND `serverSeq` is strictly greater than the
   * last applied. Stale or unknown-channel envelopes return false.
   */
  public shouldApply(channel: URI, serverSeq: number): boolean {
    const entry = this.channels.get(channel);
    if (entry === undefined) {
      return false;
    }
    return serverSeq > entry.lastServerSeq;
  }

  /** Highest `lastServerSeq` across all channels (used for `reconnect` RPC). */
  public maxAppliedServerSeq(): number {
    let max = 0;
    for (const entry of this.channels.values()) {
      if (entry.lastServerSeq > max) {
        max = entry.lastServerSeq;
      }
    }
    return max;
  }

  /** Remove a channel entry entirely. Subscribers attached to it are NOT closed here. */
  public drop(channel: URI): void {
    this.channels.delete(channel);
  }

  /** Remove every channel entry. */
  public clear(): void {
    this.channels.clear();
  }
}

const EMPTY_SUBS: ReadonlySet<AsyncQueue<SubscriptionMessage>> = new Set();
