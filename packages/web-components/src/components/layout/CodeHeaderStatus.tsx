/**
 * CodeHeaderStatus — presentational status line for the Code context header.
 * Contains both the pure computation ({@link describeCodeStatus}) and the
 * React component ({@link CodeHeaderStatus}).
 *
 * @module
 */

import type { JSX } from "react";
import type { Session } from "../../hooks/types.js";
import { isActiveSession } from "../sessions/sessionsView.js";
import { formatRelativeTime } from "../../utils/time.js";

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

/** Summary of session activity for the Code context header. */
export interface CodeStatusSummary {
  /** Number of currently active (live) sessions. */
  activeCount: number;
  /** ISO timestamp of the most recently started session, or `undefined` if none. */
  lastActivityAt: string | undefined;
}

/** Derive a Code context status summary from the sessions array. */
export function describeCodeStatus(
  sessions: readonly Pick<Session, "status" | "endReason" | "startedAt">[],
): CodeStatusSummary {
  let activeCount: number = 0;
  let lastActivityAt: string | undefined;
  for (const s of sessions) {
    if (isActiveSession(s)) {
      activeCount++;
    }
    if (!lastActivityAt || s.startedAt > lastActivityAt) {
      lastActivityAt = s.startedAt;
    }
  }
  return { activeCount, lastActivityAt };
}

// ---------------------------------------------------------------------------
// Presentational component
// ---------------------------------------------------------------------------

/** Inline styles matching the agent header's HeartbeatStatus pattern. */
const STATUS_ITEM_STYLE: React.CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--text-tertiary)",
  whiteSpace: "nowrap",
};

/** Props for {@link CodeHeaderStatus}. */
export interface CodeHeaderStatusProps {
  /** Summary computed by {@link describeCodeStatus}. */
  summary: CodeStatusSummary;
}

/** Renders the Code context header status line. Returns nothing when there is no data. */
export function CodeHeaderStatus({ summary }: CodeHeaderStatusProps): JSX.Element | undefined {
  const { activeCount, lastActivityAt } = summary;

  if (activeCount === 0 && !lastActivityAt) {
    return undefined;
  }

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}
      data-testid="code-header-status"
    >
      {activeCount > 0 && (
        <span style={STATUS_ITEM_STYLE} data-testid="code-header-active-sessions">
          {activeCount} active {activeCount === 1 ? "session" : "sessions"}
        </span>
      )}
      {lastActivityAt && (
        <span style={STATUS_ITEM_STYLE} data-testid="code-header-last-activity">
          Last activity {formatRelativeTime(lastActivityAt)}
        </span>
      )}
    </div>
  );
}
