import { useCallback, useEffect, useState, type JSX } from "react";
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
    streams: { streams, streamsLoading, streamsLoadedOnce, streamsLoadError, loadStreams },
    sessions: { sessions },
    tasks: { tasks },
  } = useGrackle();

  const [showInternals, setShowInternals] = useState(false);
  const [selectedStreamId, setSelectedStreamId] = useState<string | undefined>(undefined);

  // Re-fetch whenever the internals toggle changes (server-side filtering).
  useEffect(() => {
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
        <StreamDetailPanel stream={selectedStream} onClose={() => setSelectedStreamId(undefined)} />
      )}
    </div>
  );
}
