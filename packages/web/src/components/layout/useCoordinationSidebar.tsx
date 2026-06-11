import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { CoordinationList, useThemeContext } from "@grackle-ai/web-components";
import type { StreamData } from "@grackle-ai/web-components";

/** Context passed to CoordinationPage via outlet context. */
export interface CoordinationOutletContext {
  /** Currently selected stream, if any. */
  selectedStream: StreamData | undefined;
  /** Currently selected stream ID. */
  selectedStreamId: string | undefined;
  /** Set the selected stream ID. */
  setSelectedStreamId: (id: string | undefined) => void;
  /** Whether a transcript is currently loading. */
  transcriptLoading: boolean;
  /** Resolved theme ID for graph rendering. */
  resolvedThemeId: string;
}

/** Return type of the useCoordinationSidebar hook. */
export interface UseCoordinationSidebarResult {
  /** The memoised CoordinationList sidebar element to pass to useSidebarSlot. */
  sidebar: ReactNode;
  /** Outlet context to pass to <Outlet context={...}>. */
  outletContext: CoordinationOutletContext;
}

/**
 * Manages sidebar and outlet context for WithCoordinationSidebar.
 * Calls useGrackle() — must only be used from layout/route components or pages.
 */
export function useCoordinationSidebar(): UseCoordinationSidebarResult {
  const {
    streams: {
      streams,
      streamsLoading,
      streamsLoadedOnce,
      streamsLoadError,
      loadStreams,
      loadTranscript,
    },
    sessions: { sessions },
    tasks: { tasks },
  } = useGrackle();

  const [showInternals, setShowInternals] = useState(false);
  const [selectedStreamId, setSelectedStreamId] = useState<string | undefined>(undefined);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

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

  const sidebar = useMemo(
    () => (
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
    ),
    [
      streams,
      sessions,
      tasks,
      streamsLoading,
      streamsLoadError,
      streamsLoadedOnce,
      showInternals,
      selectedStreamId,
      handleRefresh,
    ],
  );

  const { resolvedThemeId } = useThemeContext();

  const outletContext = useMemo<CoordinationOutletContext>(
    () => ({
      selectedStream,
      selectedStreamId,
      setSelectedStreamId,
      transcriptLoading,
      resolvedThemeId,
    }),
    [selectedStream, selectedStreamId, transcriptLoading, resolvedThemeId],
  );

  return { sidebar, outletContext };
}
