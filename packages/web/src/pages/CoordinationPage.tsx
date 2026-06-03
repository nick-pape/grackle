import type { JSX } from "react";
import { useOutletContext } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { CoordinationGraph, StreamDetailPanel } from "@grackle-ai/web-components";
import type { CoordinationOutletContext } from "../components/layout/WithSidebar.js";
import styles from "./CoordinationPage.module.scss";

/**
 * Coordination page — always shows the live network graph in the main content
 * area. The stream list lives in the sidebar (via WithCoordinationSidebar).
 * Selecting a stream in either the list or graph opens the detail drawer.
 */
export function CoordinationPage(): JSX.Element {
  const {
    streams: { streams, liveMessages },
    sessions: { sessions },
  } = useGrackle();

  const {
    selectedStream,
    selectedStreamId,
    setSelectedStreamId,
    transcriptLoading,
    resolvedThemeId,
  } = useOutletContext<CoordinationOutletContext>();

  return (
    <div className={styles.container} data-testid="coordination-page">
      <CoordinationGraph
        streams={streams}
        sessions={sessions}
        selectedStreamId={selectedStreamId}
        onSelectStream={setSelectedStreamId}
        recentMessages={liveMessages}
        resolvedThemeId={resolvedThemeId}
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
