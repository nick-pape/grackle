/**
 * ScheduleNav — vertical sidebar navigation for the Schedules page.
 *
 * @module
 */

import { useCallback, useRef, type JSX, type KeyboardEvent } from "react";
import { Circle } from "lucide-react";
import { ICON_XS } from "../../utils/iconSize.js";
import { useMatch } from "react-router";
import type { PersonaData, ScheduleData } from "../../hooks/types.js";
import { scheduleUrl, NEW_SCHEDULE_URL, useAppNavigate } from "../../utils/navigation.js";
import { formatCountdown } from "../../utils/time.js";
import styles from "./ScheduleNav.module.scss";

/** Props for the ScheduleNav component. */
export interface ScheduleNavProps {
  /** List of all schedules to display in the nav. */
  schedules: ScheduleData[];
  /** All personas — used to resolve persona names for trailing badges. */
  personas: PersonaData[];
}

/** Vertical nav rail listing schedules with enabled/disabled status dots. */
export function ScheduleNav({ schedules, personas }: ScheduleNavProps): JSX.Element {
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const detailMatch = useMatch("/schedules/:scheduleId");
  const rawId = detailMatch?.params.scheduleId;
  const activeId = rawId === "new" ? undefined : rawId;

  const personaMap = new Map(personas.map((p) => [p.id, p]));

  const handleClick = useCallback(
    (scheduleId: string) => {
      navigate(scheduleUrl(scheduleId));
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
      const currentIndex =
        focusedIndex >= 0 ? focusedIndex : schedules.findIndex((s) => s.id === activeId);
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

      if (nextIndex < schedules.length) {
        navigate(scheduleUrl(schedules[nextIndex].id));
      }
      buttons[nextIndex].focus();
    },
    [activeId, schedules, navigate],
  );

  const focusableId = activeId ?? (schedules.length > 0 ? schedules[0].id : undefined);

  return (
    <div className={styles.nav} data-testid="schedule-nav">
      <nav
        ref={tabListRef}
        role="tablist"
        aria-orientation="vertical"
        aria-label="Schedules"
        onKeyDown={handleKeyDown}
      >
        {schedules.map((schedule) => {
          const isActive = schedule.id === activeId;
          const isFocusable = schedule.id === focusableId;
          const statusColor = schedule.enabled ? "var(--accent-green)" : "var(--text-tertiary)";
          const persona = personaMap.get(schedule.personaId);
          const trailingText =
            schedule.enabled && schedule.nextRunAt
              ? formatCountdown(schedule.nextRunAt)
              : persona?.name;
          return (
            <button
              key={schedule.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              tabIndex={isFocusable ? 0 : -1}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              onClick={() => handleClick(schedule.id)}
              data-testid="schedule-nav-item"
            >
              <span className={styles.statusDot} style={{ color: statusColor }} aria-hidden="true">
                <Circle size={ICON_XS} fill="currentColor" />
              </span>
              <span className={styles.tabLabel} title={schedule.title}>
                {schedule.title}
              </span>
              {trailingText && (
                <span className={styles.trailingBadge} title={trailingText}>
                  {trailingText}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <button
        type="button"
        className={styles.addButton}
        onClick={() => navigate(NEW_SCHEDULE_URL)}
        title="New schedule"
        data-testid="schedule-nav-add"
      >
        + New Schedule
      </button>

      {schedules.length === 0 && <div className={styles.empty}>No schedules yet.</div>}
    </div>
  );
}
