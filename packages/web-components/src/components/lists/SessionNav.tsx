/**
 * SessionNav -- vertical sidebar navigation for the Sessions monitor.
 *
 * @module
 */

import { useCallback, useMemo, useRef, type JSX, type KeyboardEvent } from "react";
import { Circle } from "lucide-react";
import { ICON_XS } from "../../utils/iconSize.js";
import { useMatch } from "react-router";
import type { Environment, Session } from "../../hooks/types.js";
import { sessionUrl, useAppNavigate } from "../../utils/navigation.js";
import { SectionHeader } from "../display/SectionHeader.js";
import { describeSessionStatus, groupSessionsByEnvironment } from "../sessions/sessionsView.js";
import styles from "./SessionNav.module.scss";

/** CSS custom-property names for each status tone. */
const TONE_COLORS: Record<string, string> = {
  running: "var(--accent-green)",
  idle: "var(--accent-blue)",
  pending: "var(--text-tertiary)",
  success: "var(--accent-green)",
  error: "var(--accent-red)",
  paused: "var(--accent-yellow)",
  neutral: "var(--text-tertiary)",
};

/** Props for the SessionNav component. */
export interface SessionNavProps {
  /** Sessions to list in the nav. */
  sessions: Session[];
  /** Environments, used to resolve display names for group headers. */
  environments: Environment[];
}

/** Vertical nav rail listing sessions grouped by environment, with status dots. */
export function SessionNav({ sessions, environments }: SessionNavProps): JSX.Element {
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const detailMatch = useMatch("/sessions/:sessionId");
  const activeId = detailMatch?.params.sessionId;

  const groups = useMemo(
    () => groupSessionsByEnvironment(sessions, environments),
    [sessions, environments],
  );

  const flatSessions = useMemo(() => groups.flatMap((g) => g.sessions), [groups]);

  const activeInList = activeId && flatSessions.some((s) => s.id === activeId);
  const focusableId =
    (activeInList ? activeId : undefined) ??
    (flatSessions.length > 0 ? flatSessions[0].id : undefined);

  const handleClick = useCallback(
    (sessionId: string) => {
      navigate(sessionUrl(sessionId));
    },
    [navigate],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      if (!buttons || buttons.length === 0) {
        return;
      }
      const focusedIndex = Array.from(buttons).findIndex((b) => b === document.activeElement);
      const activeIndex = flatSessions.findIndex((s) => s.id === activeId);
      // Use focused button if present; fall back to active session; fall back to first element.
      const currentIndex = focusedIndex >= 0 ? focusedIndex : Math.max(activeIndex, 0);
      let nextIndex = currentIndex;

      if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % buttons.length;
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIndex = buttons.length - 1;
      } else {
        return;
      }

      if (nextIndex < flatSessions.length) {
        navigate(sessionUrl(flatSessions[nextIndex].id));
      }
      buttons[nextIndex].focus();
    },
    [activeId, flatSessions, navigate],
  );

  return (
    <div className={styles.container} data-testid="session-nav">
      <div className={styles.headerWrapper}>
        <SectionHeader title="Sessions" data-testid="session-nav-header" />
      </div>

      <nav
        ref={tabListRef}
        role="tablist"
        aria-orientation="vertical"
        aria-label="Sessions"
        onKeyDown={handleKeyDown}
        className={styles.nav}
      >
        {groups.map((group) => (
          <div key={group.environmentId}>
            {groups.length > 1 && (
              <div className={styles.groupLabel}>
                {group.environment?.displayName ?? group.environmentId}
              </div>
            )}
            {group.sessions.map((session) => {
              const isActive = session.id === activeId;
              const isFocusable = session.id === focusableId;
              const { tone } = describeSessionStatus(session);
              const dotColor = TONE_COLORS[tone] ?? "var(--text-tertiary)";
              return (
                <button
                  key={session.id}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  tabIndex={isFocusable ? 0 : -1}
                  className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
                  onClick={() => handleClick(session.id)}
                  data-testid="session-nav-item"
                >
                  <span className={styles.statusDot} style={{ color: dotColor }} aria-hidden="true">
                    <Circle size={ICON_XS} fill="currentColor" />
                  </span>
                  <span className={styles.tabLabel} title={session.prompt || session.id}>
                    {session.id.slice(0, 8)}
                  </span>
                  {session.runtime && (
                    <span className={styles.trailingBadge} title={session.runtime}>
                      {session.runtime}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {sessions.length === 0 && <div className={styles.empty}>No sessions yet.</div>}
    </div>
  );
}
