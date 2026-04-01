/**
 * StreamList — sidebar list of IPC streams with a pinned "System" entry.
 *
 * @module
 */

import { useCallback, type JSX } from "react";
import { useLocation, useMatch } from "react-router";
import { MessageSquare, Radio, RefreshCw } from "lucide-react";
import type { StreamData } from "../../hooks/types.js";
import { useAppNavigate, chatStreamUrl, CHAT_URL } from "../../utils/navigation.js";
import styles from "./StreamList.module.scss";

/** Size for row icons. */
const ICON_SIZE: number = 14;

/** Props for the StreamList sidebar component. */
export interface StreamListProps {
  /** All known IPC streams. */
  streams: StreamData[];
  /** Whether streams are currently loading. */
  loading: boolean;
  /** Optional callback to trigger a stream list refresh. */
  onRefresh?: () => void;
}

/**
 * Sidebar list showing IPC streams.
 *
 * The "System" row is always pinned at the top and links to `/chat`.
 * Named streams are listed below, sorted alphabetically.
 */
export function StreamList({ streams, loading, onRefresh }: StreamListProps): JSX.Element {
  const navigate = useAppNavigate();
  const location = useLocation();
  const streamMatch = useMatch("/chat/:streamId");

  const selectedStreamId = streamMatch?.params.streamId;
  const isSystemSelected = !selectedStreamId && location.pathname === CHAT_URL;

  const sortedStreams = [...streams].sort((a, b) => a.name.localeCompare(b.name));

  const handleSystemClick = useCallback(() => {
    navigate(CHAT_URL);
  }, [navigate]);

  const handleStreamClick = useCallback((streamId: string) => {
    navigate(chatStreamUrl(streamId));
  }, [navigate]);

  return (
    <div className={styles.container} data-testid="stream-list">
      <div className={styles.header}>
        <span>Streams</span>
        {onRefresh && (
          <button
            className={styles.refreshButton}
            onClick={onRefresh}
            aria-label="Refresh streams"
            data-testid="stream-list-refresh"
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>

      {/* Pinned System row */}
      <button
        type="button"
        className={`${styles.systemRow}${isSystemSelected ? ` ${styles.selected}` : ""}`}
        onClick={handleSystemClick}
        data-testid="stream-list-system-row"
        aria-current={isSystemSelected ? "page" : undefined}
      >
        <MessageSquare size={ICON_SIZE} className={styles.streamIcon} />
        <span className={styles.streamName}>System</span>
      </button>

      {/* Named streams */}
      {loading && sortedStreams.length === 0 && (
        <div className={styles.loading}>Loading...</div>
      )}
      {!loading && sortedStreams.length === 0 && (
        <div className={styles.emptyState}>No streams</div>
      )}
      {sortedStreams.map((stream) => {
        const isSelected = selectedStreamId === stream.id;
        return (
          <button
            key={stream.id}
            type="button"
            className={`${styles.streamRow}${isSelected ? ` ${styles.selected}` : ""}`}
            onClick={() => handleStreamClick(stream.id)}
            data-testid={`stream-list-row-${stream.id}`}
            aria-current={isSelected ? "page" : undefined}
          >
            <Radio size={ICON_SIZE} className={styles.streamIcon} />
            <span className={styles.streamName}>{stream.name}</span>
            {stream.subscriberCount > 0 && (
              <span className={styles.subscriberBadge}>{stream.subscriberCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
