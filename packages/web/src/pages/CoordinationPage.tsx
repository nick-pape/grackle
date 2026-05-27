import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import {
  CoordinationGraph,
  CoordinationList,
  StreamDetailPanel,
  useThemeContext,
} from "@grackle-ai/web-components";
import styles from "./CoordinationPage.module.scss";

/**
 * Coordination page — a read-only inventory of IPC streams, grouped by the task
 * that owns them. Internal plumbing (lifecycle/pipe/stdin) is hidden behind a
 * "Show internals" toggle. Selecting a stream opens its detail drawer. A
 * List/Graph toggle switches between the inventory and a live network graph.
 */
export function CoordinationPage(): JSX.Element {
  const {
    streams: {
      streams,
      streamsLoading,
      streamsLoadedOnce,
      streamsLoadError,
      loadStreams,
      liveMessages,
      loadTranscript,
    },
    sessions: { sessions },
    tasks: { tasks },
  } = useGrackle();
  const { resolvedThemeId } = useThemeContext();

  const [viewMode, setViewMode] = useState<"list" | "graph">("list");
  const [showInternals, setShowInternals] = useState(false);
  const [selectedStreamId, setSelectedStreamId] = useState<string | undefined>(undefined);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  // Fetch the durable transcript (scrollback) when a stream is selected; live
  // messages merge into the same buffer via the streams hook.
  useEffect(() => {
    if (selectedStreamId === undefined) {
      setTranscriptLoading(false);
      return;
    }
    let active = true;
    setTranscriptLoading(true);
    loadTranscript(selectedStreamId)
      .then(() => {
        if (active) {
          setTranscriptLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setTranscriptLoading(false);
        }
      });
    return () => {
      active = false;
    };
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

  const selectedStream =
    selectedStreamId !== undefined ? streams.find((s) => s.id === selectedStreamId) : undefined;

  return (
    <div className={styles.container} data-testid="coordination-page">
      <div className={styles.toolbar}>
        <div
          className={styles.viewToggle}
          role="group"
          aria-label="Coordination view"
          data-testid="coordination-view-toggle"
        >
          <button
            type="button"
            className={
              viewMode === "list"
                ? `${styles.toggleButton} ${styles.toggleActive}`
                : styles.toggleButton
            }
            aria-pressed={viewMode === "list"}
            data-testid="coordination-view-list"
            onClick={() => setViewMode("list")}
          >
            List
          </button>
          <button
            type="button"
            className={
              viewMode === "graph"
                ? `${styles.toggleButton} ${styles.toggleActive}`
                : styles.toggleButton
            }
            aria-pressed={viewMode === "graph"}
            data-testid="coordination-view-graph"
            onClick={() => setViewMode("graph")}
          >
            Graph
          </button>
        </div>
        <div className={styles.toolbarControls}>
          <label className={styles.internalsToggle}>
            <input
              type="checkbox"
              checked={showInternals}
              onChange={(e) => setShowInternals(e.target.checked)}
              data-testid="coordination-show-internals"
            />
            Show internals
          </label>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={handleRefresh}
            aria-label="Refresh streams"
            data-testid="coordination-refresh"
          >
            Refresh
          </button>
        </div>
      </div>
      {viewMode === "list" ? (
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
          hideHeaderControls
        />
      ) : (
        <CoordinationGraph
          streams={streams}
          sessions={sessions}
          selectedStreamId={selectedStreamId}
          onSelectStream={setSelectedStreamId}
          recentMessages={liveMessages}
          resolvedThemeId={resolvedThemeId}
        />
      )}
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
