/**
 * Sidebar navigation for the Findings pages.
 *
 * Displays a list of findings with category pills and relative timestamps.
 *
 * @module
 */

import { useCallback, useMemo, useRef, type JSX, type KeyboardEvent } from "react";
import { useMatch } from "react-router";
import type { FindingData } from "../../hooks/types.js";
import { findingUrl, useAppNavigate } from "../../utils/navigation.js";
import { formatRelativeTime } from "../../utils/time.js";
import styles from "./FindingsNav.module.scss";

/** Category color mapping matching FindingsPanel. */
const CATEGORY_COLORS: Record<string, string> = {
  architecture: "var(--accent-blue)",
  api: "var(--accent-green)",
  bug: "var(--accent-red)",
  decision: "var(--accent-yellow)",
  dependency: "var(--accent-purple)",
  pattern: "var(--accent-cyan)",
  general: "var(--text-tertiary)",
};

/** Props for the FindingsNav component. */
interface FindingsNavProps {
  /** All loaded findings to display. */
  findings: FindingData[];
}

/** Sidebar nav listing findings with category badges and relative timestamps. */
export function FindingsNav({ findings }: FindingsNavProps): JSX.Element {
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const findingMatch = useMatch("/findings/:findingId");
  const activeFindingId = findingMatch?.params.findingId;

  /** Unique categories derived from the current findings list. */
  const categories = useMemo(() => {
    const cats = new Set(findings.map((f) => f.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [findings]);

  const handleClick = useCallback((findingId: string) => {
    navigate(findingUrl(findingId));
  }, [navigate]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    if (!buttons || buttons.length === 0) {
      return;
    }
    const focusedIndex = Array.from(buttons).findIndex((b) => b === document.activeElement);
    const currentIndex = focusedIndex >= 0 ? focusedIndex : findings.findIndex((f) => f.id === activeFindingId);
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

    if (nextIndex < findings.length) {
      navigate(findingUrl(findings[nextIndex].id));
    }
    buttons[nextIndex].focus();
  }, [activeFindingId, findings, navigate]);

  const focusableId = activeFindingId ?? (findings.length > 0 ? findings[0].id : undefined);

  return (
    <div className={styles.nav} data-testid="findings-nav">
      {categories.length > 1 && (
        <div className={styles.categoryPills} data-testid="findings-nav-categories">
          {categories.map((cat) => (
            <span
              key={cat}
              className={styles.categoryPill}
              style={{ color: CATEGORY_COLORS[cat] || CATEGORY_COLORS.general }}
            >
              {cat}
            </span>
          ))}
        </div>
      )}

      <nav
        ref={tabListRef}
        role="tablist"
        aria-orientation="vertical"
        aria-label="Findings"
        onKeyDown={handleKeyDown}
      >
        {findings.map((f) => {
          const isActive = f.id === activeFindingId;
          const isFocusable = f.id === focusableId;
          const catColor = CATEGORY_COLORS[f.category] || CATEGORY_COLORS.general;
          return (
            <button
              key={f.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              tabIndex={isFocusable ? 0 : -1}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              onClick={() => handleClick(f.id)}
              data-testid="finding-nav-item"
            >
              <span
                className={styles.categoryDot}
                style={{ color: catColor }}
              >
                {"\u25CF"}
              </span>
              <span className={styles.tabContent}>
                <span className={styles.tabLabel} title={f.title}>
                  {f.title}
                </span>
                <span className={styles.tabMeta} title={f.createdAt}>
                  {formatRelativeTime(f.createdAt)}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      {findings.length === 0 && (
        <div className={styles.empty}>
          No findings yet. Agents will post discoveries here.
        </div>
      )}
    </div>
  );
}
