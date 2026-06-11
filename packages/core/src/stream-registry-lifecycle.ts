/**
 * Singleton lifecycle callback registration for the stream-registry subsystem.
 *
 * Exposes `onSessionOrphaned` and `onSessionRevived` — two singleton slots
 * wired by the server's lifecycle manager. Kept separate from
 * {@link ./stream-registry-state.ts} so the barrel re-export is straightforward.
 */
import {
  orphanCallback,
  revivedCallback,
  setOrphanCallback,
  setRevivedCallback,
} from "./stream-registry-state.js";

/** @internal */
type OrphanCallback = (sessionId: string) => void;
/** @internal */
type RevivedCallback = (targetSessionId: string, subscriberSessionId: string) => void;

/**
 * Register a callback invoked when a session has zero remaining subscriptions.
 * Used by the lifecycle manager to auto-hibernate orphaned sessions.
 *
 * **Singleton semantics**: only one callback is supported at a time. A new
 * registration overwrites the previous one (last-wins). This is intentional —
 * there is exactly one lifecycle manager per server instance.
 *
 * @returns An unsubscribe function that removes the callback.
 */
export function onSessionOrphaned(cb: OrphanCallback): () => void {
  setOrphanCallback(cb);
  return () => {
    if (orphanCallback === cb) {
      setOrphanCallback(undefined);
    }
  };
}

/**
 * Register a callback invoked when an external session subscribes to a
 * lifecycle stream. Used by the lifecycle manager to auto-reanimate
 * stopped sessions when a new fd is opened.
 *
 * **Singleton semantics**: only one callback is supported at a time. A new
 * registration overwrites the previous one (last-wins). This is intentional —
 * there is exactly one lifecycle manager per server instance.
 *
 * @returns An unsubscribe function that removes the callback.
 */
export function onSessionRevived(cb: RevivedCallback): () => void {
  setRevivedCallback(cb);
  return () => {
    if (revivedCallback === cb) {
      setRevivedCallback(undefined);
    }
  };
}
