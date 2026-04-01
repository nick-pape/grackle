/**
 * Domain hook for IPC stream management.
 *
 * Uses ConnectRPC to fetch the current stream list. No server-side domain
 * events exist for stream lifecycle yet, so the hook reloads on connect and
 * whenever callers trigger a refresh (e.g. after session events).
 *
 * @module
 */

import { useState, useCallback, useRef } from "react";
import type { StreamData, GrackleEvent, UseStreamsResult } from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { coreClient as grackleClient } from "./useGrackleClient.js";
import { protoToStream } from "./proto-converters.js";
import { useLoadingState } from "./useLoadingState.js";

export type { UseStreamsResult } from "@grackle-ai/web-components";

/**
 * Hook that manages IPC stream state via ConnectRPC.
 *
 * @returns Stream state, a load action, and domain hook lifecycle.
 */
export function useStreams(): UseStreamsResult {
  const [streams, setStreams] = useState<StreamData[]>([]);
  const [streamsLoadedOnce, setStreamsLoadedOnce] = useState(false);
  const { loading: streamsLoading, track: trackStreams } = useLoadingState();
  /** Incremented on disconnect so in-flight responses from the previous connection are discarded. */
  const epochRef = useRef(0);

  const loadStreams = useCallback(async (): Promise<void> => {
    const myEpoch = epochRef.current;
    try {
      const resp = await trackStreams(grackleClient.listStreams({}));
      if (epochRef.current === myEpoch) {
        setStreams(resp.streams.map(protoToStream));
      }
    } catch {
      // empty
    } finally {
      if (epochRef.current === myEpoch) {
        setStreamsLoadedOnce(true);
      }
    }
  }, [trackStreams]);

  const handleEvent = useCallback((_event: GrackleEvent): boolean => {
    // No stream domain events exist yet — nothing to consume.
    return false;
  }, []);

  const domainHook: DomainHook = {
    onConnect: loadStreams,
    onDisconnect: () => { epochRef.current += 1; setStreams([]); setStreamsLoadedOnce(false); },
    handleEvent,
  };

  return {
    streams,
    streamsLoading,
    streamsLoadedOnce,
    loadStreams,
    handleEvent,
    domainHook,
  };
}
