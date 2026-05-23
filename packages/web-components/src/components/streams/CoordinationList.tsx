/**
 * CoordinationList — read-only inventory of IPC streams for the Coordination tab.
 *
 * Groups streams by the task that owns their subscribers (with a trailing
 * unattached/external bucket), tags each by kind, and offers a "Show internals"
 * toggle to reveal internal IPC plumbing (lifecycle/pipe/stdin).
 *
 * Pure presentational component — data and callbacks come from the page.
 *
 * @module
 */

import { type JSX } from "react";
import { GitBranch, Hash, MessagesSquare, RefreshCw } from "lucide-react";
import type { Session, StreamData, TaskData } from "../../hooks/types.js";
import { groupStreamsByTask, streamKind, type StreamKind } from "../../utils/streamCoordination.js";
import { ICON_SM } from "../../utils/iconSize.js";
import styles from "./CoordinationList.module.scss";

/** Human-readable label per stream kind. */
const KIND_LABEL: Record<StreamKind, string> = {
  chatroom: "Chatroom",
  pipe: "Pipe",
  channel: "Channel",
};

/** Icon per stream kind. */
function KindIcon({ kind }: { kind: StreamKind }): JSX.Element {
  if (kind === "chatroom") {
    return <MessagesSquare size={ICON_SM} aria-hidden="true" />;
  }
  if (kind === "pipe") {
    return <GitBranch size={ICON_SM} aria-hidden="true" />;
  }
  return <Hash size={ICON_SM} aria-hidden="true" />;
}

/** Props for the CoordinationList component. */
export interface CoordinationListProps {
  /** Streams to display (already filtered server-side by the internals toggle). */
  streams: StreamData[];
  /** All known sessions, used to attribute streams to their owning task. */
  sessions: Session[];
  /** Known tasks (only `id` + `title` are used), to render group headers. */
  tasks: readonly Pick<TaskData, "id" | "title">[];
  /** Whether streams are currently loading. */
  loading: boolean;
  /** True if the most recent load attempt failed. */
  loadError?: boolean;
  /** True after at least one load attempt has completed. */
  loadedOnce?: boolean;
  /** Whether internal IPC plumbing is currently shown. */
  showInternals: boolean;
  /** Called when the "Show internals" toggle changes. */
  onToggleInternals: (value: boolean) => void;
  /** Currently selected stream id (for highlight). */
  selectedStreamId?: string;
  /** Called when a stream row is clicked. */
  onSelectStream: (streamId: string) => void;
  /** Optional refresh callback. */
  onRefresh?: () => void;
}

/** Read-only, task-grouped inventory of IPC streams. */
export function CoordinationList({
  streams,
  sessions,
  tasks,
  loading,
  loadError = false,
  loadedOnce = true,
  showInternals,
  onToggleInternals,
  selectedStreamId,
  onSelectStream,
  onRefresh,
}: CoordinationListProps): JSX.Element {
  const groups = groupStreamsByTask(streams, sessions);
  const kindClass: Record<StreamKind, string> = {
    chatroom: styles.kindChatroom,
    pipe: styles.kindPipe,
    channel: styles.kindChannel,
  };
  const taskTitle = (taskId: string): string => tasks.find((t) => t.id === taskId)?.title ?? taskId;

  return (
    <div className={styles.container} data-testid="coordination-list">
      <div className={styles.header}>
        <span className={styles.title}>Coordination</span>
        <div className={styles.headerActions}>
          <label className={styles.internalsToggle}>
            <input
              type="checkbox"
              checked={showInternals}
              onChange={(e) => onToggleInternals(e.target.checked)}
              data-testid="coordination-show-internals"
            />
            Show internals
          </label>
          {onRefresh && (
            <button
              type="button"
              className={styles.refreshButton}
              onClick={onRefresh}
              aria-label="Refresh streams"
              data-testid="coordination-refresh"
            >
              <RefreshCw size={ICON_SM} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {loading && streams.length === 0 && <div className={styles.state}>Loading{"…"}</div>}
      {!loading && loadError && (
        <div className={styles.state} data-testid="coordination-error">Unable to load streams</div>
      )}
      {!loading && !loadError && loadedOnce && streams.length === 0 && (
        <div className={styles.state} data-testid="coordination-empty">No active streams</div>
      )}

      {groups.map((group) => (
        <div key={group.taskId ?? "__orphans__"} className={styles.group}>
          <div className={styles.groupHeader}>
            {group.taskId ? taskTitle(group.taskId) : "Unattached / external (CLI · MCP)"}
          </div>
          {group.streams.map((stream) => {
            const kind = streamKind(stream);
            const isSelected = stream.id === selectedStreamId;
            return (
              <button
                key={stream.id}
                type="button"
                className={`${styles.row}${isSelected ? ` ${styles.selected}` : ""}`}
                onClick={() => onSelectStream(stream.id)}
                data-testid={`coordination-row-${stream.id}`}
                aria-current={isSelected ? "page" : undefined}
              >
                <span className={`${styles.kindBadge} ${kindClass[kind]}`}>
                  <KindIcon kind={kind} /> {KIND_LABEL[kind]}
                </span>
                <span className={styles.streamName}>{stream.name}</span>
                <span className={styles.meta}>
                  {stream.subscriberCount} {stream.subscriberCount === 1 ? "sub" : "subs"} {"·"} {stream.messageBufferDepth} buffered
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
