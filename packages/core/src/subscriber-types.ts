/**
 * Types for the subscriber factory pattern.
 *
 * Defines the standard factory signature so subscribers can be grouped,
 * initialized, and disposed as a unit — the foundation for the plugin
 * architecture (issue #1119).
 *
 * @module
 */

import type { GrackleEvent, GrackleEventType, Subscriber } from "./event-bus.js";

/** A resource that can be disposed to clean up subscriptions and state. */
export interface Disposable {
  /** Release all resources (unsubscribe callbacks, clear dedup maps, etc.). */
  dispose(): void;
}

/** Minimal context passed to subscriber factories. */
export interface PluginContext {
  /** Register an event-bus subscriber. Returns an unsubscribe function. */
  subscribe: (subscriber: Subscriber) => () => void;
  /** Emit a domain event. */
  emit: (type: GrackleEventType, payload: Record<string, unknown>) => GrackleEvent;
}

/** Factory function that creates a subscriber and returns a Disposable for cleanup. */
export type SubscriberFactory = (ctx: PluginContext) => Disposable;
