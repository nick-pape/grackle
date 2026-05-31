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
import type {
  StreamData,
  StreamMessageData,
  GrackleEvent,
  UseStreamsResult,
} from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { coreClient as grackleClient } from "./useGrackleClient.js";
import { protoToStream } from "./proto-converters.js";
import { useLoadingState } from "./useLoadingState.js";

export type { UseStreamsResult } from "@grackle-ai/web-components";

/** Max live messages retained per stream in the in-memory buffer. */
const MAX_LIVE_MESSAGES_PER_STREAM: number = 500;

/**
 * Hook that manages IPC stream state via ConnectRPC.
 *
 * @returns Stream state, a load action, and domain hook lifecycle.
 */
export function useStreams(): UseStreamsResult {
  const [streams, setStreams] = useState<StreamData[]>([]);
  const [liveMessages, setLiveMessages] = useState<Record<string, StreamMessageData[]>>({});
  const [streamsLoadedOnce, setStreamsLoadedOnce] = useState(false);
  const [streamsLoadError, setStreamsLoadError] = useState(false);
  const { loading: streamsLoading, track: trackStreams } = useLoadingState();
  /** Incremented on disconnect so in-flight responses from the previous connection are discarded. */
  const epochRef = useRef(0);

  const loadStreams = useCallback(
    async (includeInternal: boolean = false): Promise<void> => {
      const myEpoch = epochRef.current;
      try {
        const resp = await trackStreams(grackleClient.listStreams({ includeInternal }));
        if (epochRef.current === myEpoch) {
          setStreams(resp.streams.map(protoToStream));
          setStreamsLoadError(false);
        }
      } catch {
        if (epochRef.current === myEpoch) {
          setStreamsLoadError(true);
        }
      } finally {
        if (epochRef.current === myEpoch) {
          setStreamsLoadedOnce(true);
        }
      }
    },
    [trackStreams],
  );

  /** Fetch a stream's durable transcript (scrollback) and merge it into the buffer. */
  const loadTranscript = useCallback(
    async (streamId: string, beforeSeq?: string): Promise<void> => {
      let fetched: StreamMessageData[];
      try {
        const resp = await grackleClient.getStreamTranscript({
          streamId,
          beforeSeq: beforeSeq ?? "",
          limit: 0,
        });
        fetched = resp.messages.map((m) => ({
          streamId: m.streamId,
          seq: m.seq,
          senderId: m.senderId,
          content: m.content,
          timestamp: m.timestamp,
        }));
      } catch {
        return; // best-effort; leave the buffer as-is
      }
      setLiveMessages((prev) => {
        const bySeq = new Map<string, StreamMessageData>();
        for (const m of prev[streamId] ?? []) {
          bySeq.set(m.seq, m);
        }
        for (const m of fetched) {
          bySeq.set(m.seq, m);
        }
        const merged = Array.from(bySeq.values()).sort((a, b) => a.seq.localeCompare(b.seq));
        const capped =
          merged.length > MAX_LIVE_MESSAGES_PER_STREAM
            ? merged.slice(merged.length - MAX_LIVE_MESSAGES_PER_STREAM)
            : merged;
        return { ...prev, [streamId]: capped };
      });
    },
    [],
  );

  /** Append a live stream message to the per-stream buffer (deduped by seq, capped). */
  const handleStreamMessage = useCallback((message: StreamMessageData): void => {
    setLiveMessages((prev) => {
      const existing = prev[message.streamId] ?? [];
      if (existing.some((m) => m.seq === message.seq)) {
        return prev;
      }
      const next = [...existing, message];
      const capped =
        next.length > MAX_LIVE_MESSAGES_PER_STREAM
          ? next.slice(next.length - MAX_LIVE_MESSAGES_PER_STREAM)
          : next;
      return { ...prev, [message.streamId]: capped };
    });
  }, []);

  const handleEvent = useCallback(
    (event: GrackleEvent): boolean => {
      // Stream room lifecycle (#1309). The registry emits these for observable
      // rooms as streams are created/joined/left/closed by agents or the
      // operator; refetch the roster to reflect the new topology (ListStreams is
      // cheap — same refresh-on-event pattern as useTasks).
      switch (event.type) {
        case "stream.created":
        case "stream.attached":
        case "stream.detached":
        case "stream.closed":
          loadStreams().catch(() => {});
          return true;
        default:
          return false;
      }
    },
    [loadStreams],
  );

  const domainHook: DomainHook = {
    onConnect: loadStreams,
    onDisconnect: () => {
      epochRef.current += 1;
      setStreams([]);
      setLiveMessages({});
      setStreamsLoadedOnce(false);
      setStreamsLoadError(false);
    },
    handleEvent,
  };

  return {
    streams,
    streamsLoading,
    streamsLoadedOnce,
    streamsLoadError,
    loadStreams,
    liveMessages,
    loadTranscript,
    handleStreamMessage,
    handleEvent,
    domainHook,
  };
}
