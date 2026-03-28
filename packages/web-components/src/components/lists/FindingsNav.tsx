/**
 * Sidebar navigation for the Findings pages.
 *
 * Displays a list of findings with category pills and relative timestamps.
 *
 * @module
 */

import { useCallback, useMemo, useRef, type JSX, type KeyboardEvent } from "react";
import { Circle } from "lucide-react";
import { ICON_XS } from "../../utils/iconSize.js";
import { useMatch } from "react-router";
import type { FindingData } from "../../hooks/types.js";
import { findingUrl, useAppNavigate } from "../../utils/navigation.js";
import { formatRelativeTime } from "../../utils/time.js";
import { getCategoryColor } from "../../utils/findingCategory.js";
import styles from "./FindingsNav.module.scss";

/** Props for the FindingsNav component. */
interface FindingsNavProps {
  /** All loaded findings to display. */
  findings: FindingData[];
  /** Optional workspace ID for scoped navigation. */
  workspaceId?: string;
  /** Optional environment ID for scoped navigation. */
  environmentId?: string;
}

/** Sidebar nav listing findings with category badges and relative timestamps. */
export function FindingsNav({ findings, workspaceId, environmentId }: FindingsNavProps): JSX.Element {
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  // Match both global and workspace-scoped finding detail routes.
  const globalMatch = useMatch("/findings/:findingId");
  const scopedMatch = useMatch("/environments/:environmentId/workspaces/:workspaceId/findings/:findingId");
  const activeFindingId = globalMatch?.params.findingId ?? scopedMatch?.params.findingId;

  /** Unique categories derived from the current findings list. */
  const categories = useMemo(() => {
    const cats = new Set(findings.map((f) => f.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [findings]);

  const handleClick = useCallback((findingId: string) => {
    navigate(findingUrl(findingId, workspaceId, environmentId));
  }, [navigate, workspaceId, environmentId]);

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
      navigate(findingUrl(findings[nextIndex].id, workspaceId, environmentId));
    }
    buttons[nextIndex].focus();
  }, [activeFindingId, findings, navigate, workspaceId, environmentId]);

  const focusableId = activeFindingId ?? (findings.length > 0 ? findings[0].id : undefined);

  return (
    <div className={styles.nav} data-testid="findings-nav">
      {categories.length > 1 && (
        <div className={styles.categoryPills} data-testid="findings-nav-categories">
          {categories.map((cat) => (
            <span
              key={cat}
              className={styles.categoryPill}
              style={{ color: getCategoryColor(cat).text }}
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
                style={{ color: getCategoryColor(f.category).text }}
                aria-hidden="true"
              >
                <Circle size={ICON_XS} fill="currentColor" />
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
