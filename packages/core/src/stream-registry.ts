/**
 * Re-export barrel for the stream-registry subsystem.
 *
 * The implementation has been split into focused modules:
 * - {@link ./stream-registry-state.ts} — shared types, mutable state, and internal helpers
 * - {@link ./stream-storage.ts} — stream create/get/delete/list
 * - {@link ./subscription-manager.ts} — subscribe/unsubscribe/fd lookup
 * - {@link ./message-delivery.ts} — publish/consumeSync/replay/listeners
 *
 * This barrel preserves the `streamRegistry.*` namespace used by all consumers
 * (imported as `export * as streamRegistry` in `index.ts`).
 */

// Public types
export type {
  Permission,
  DeliveryMode,
  Stream,
  StreamMessage,
  Subscription,
  AsyncMessageListener,
} from "./stream-registry-state.js";

// Stream lifecycle callbacks
export { onSessionOrphaned, onSessionRevived } from "./stream-registry-lifecycle.js";

// Stream storage
export {
  createStream,
  getStream,
  getStreamByName,
  deleteStream,
  listStreams,
} from "./stream-storage.js";

// Subscription management
export {
  subscribe,
  unsubscribe,
  getSubscription,
  getSubscriptionsForSession,
  getOwnedSubscriptions,
} from "./subscription-manager.js";

// Message delivery
export {
  publish,
  consumeSync,
  hasUndeliveredMessages,
  replayUndeliveredMessages,
  registerAsyncListener,
  awaitPendingDeliveries,
} from "./message-delivery.js";

// Testing
export { _resetForTesting } from "./stream-registry-state.js";
