/**
 * Shared loading-state tracker for domain hooks.
 *
 * Tracks the number of in-flight async operations via a ref counter.
 * `loading` stays `true` until ALL tracked promises settle, correctly
 * handling concurrent calls (e.g., rapid reconnects or manual refreshes).
 *
 * @module
 */

import { useState, useCallback, useRef } from "react";

/** Return type for {@link useLoadingState}. */
export interface UseLoadingStateResult {
  /** Whether any tracked async operation is still in-flight. */
  loading: boolean;
  /**
   * Wrap a promise so its lifecycle is tracked. `loading` flips to `true`
   * when the first tracked promise starts, and back to `false` when all
   * tracked promises have settled (resolved or rejected).
   */
  track: <T>(promise: Promise<T>) => Promise<T>;
}

/**
 * Hook that manages a boolean loading flag with correct concurrent-call handling.
 *
 * Usage in a domain hook:
 * ```ts
 * const { loading: sessionsLoading, track } = useLoadingState();
 *
 * const loadSessions = useCallback(async () => {
 *   try {
 *     const resp = await track(grackleClient.listSessions({}));
 *     setSessions(resp.sessions.map(protoToSession));
 *   } catch {
 *     // empty
 *   }
 * }, [track]);
 * ```
 */
export function useLoadingState(): UseLoadingStateResult {
  const [loading, setLoading] = useState(false);
  const inflightRef = useRef(0);

  const track = useCallback(<T>(promise: Promise<T>): Promise<T> => {
    inflightRef.current++;
    setLoading(true);
    return promise.finally(() => {
      inflightRef.current--;
      if (inflightRef.current === 0) {
        setLoading(false);
      }
    });
  }, []);

  return { loading, track };
}
