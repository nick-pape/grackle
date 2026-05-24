import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import { CoordinationList, StreamDetailPanel } from "@grackle-ai/web-components";
import styles from "./CoordinationPage.module.scss";

/**
 * Coordination page — a read-only inventory of IPC streams, grouped by the task
 * that owns them. Internal plumbing (lifecycle/pipe/stdin) is hidden behind a
 * "Show internals" toggle. Selecting a stream opens its detail drawer.
 */
export function CoordinationPage(): JSX.Element {
  const {
    streams: { streams, streamsLoading, streamsLoadedOnce, streamsLoadError, loadStreams, liveMessages, loadTranscript },
    sessions: { sessions },
    tasks: { tasks },
  } = useGrackle();

  const [showInternals, setShowInternals] = useState(false);
  const [selectedStreamId, setSelectedStreamId] = useState<string | undefined>(undefined);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  // Fetch the durable transcript (scrollback) when a stream is selected; live
  // messages merge into the same buffer via the streams hook.
  useEffect(() => {
    if (selectedStreamId === undefined) {
      return;
    }
    let active = true;
    setTranscriptLoading(true);
    loadTranscript(selectedStreamId)
      .then(() => { if (active) { setTranscriptLoading(false); } })
      .catch(() => { if (active) { setTranscriptLoading(false); } });
    return () => { active = false; };
  }, [selectedStreamId, loadTranscript]);

  // Re-fetch when the internals toggle changes. The initial (default-false)
  // load is already performed by the streams domain hook's onConnect, so skip
  // the mount run to avoid a duplicate ListStreams RPC.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    loadStreams(showInternals).catch(() => {});
  }, [showInternals, loadStreams]);

  const handleRefresh = useCallback(() => {
    loadStreams(showInternals).catch(() => {});
  }, [loadStreams, showInternals]);

  const selectedStream = selectedStreamId !== undefined
    ? streams.find((s) => s.id === selectedStreamId)
    : undefined;

  return (
    <div className={styles.container} data-testid="coordination-page">
      <CoordinationList
        streams={streams}
        sessions={sessions}
        tasks={tasks}
        loading={streamsLoading}
        loadError={streamsLoadError}
        loadedOnce={streamsLoadedOnce}
        showInternals={showInternals}
        onToggleInternals={setShowInternals}
        selectedStreamId={selectedStreamId}
        onSelectStream={setSelectedStreamId}
        onRefresh={handleRefresh}
      />
      {selectedStream && (
        <StreamDetailPanel
          stream={selectedStream}
          messages={liveMessages[selectedStream.id] ?? []}
          transcriptLoading={transcriptLoading}
          onClose={() => setSelectedStreamId(undefined)}
        />
      )}
    </div>
  );
}
