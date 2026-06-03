/**
 * ContextDetailShell — shared header + tab bar for context detail views.
 * Used by both the Code context and Agent detail pages so the
 * back-arrow / icon / name / tab-bar pattern is rendered from one component.
 *
 * @module
 */

import { useCallback, useMemo, useRef, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { Activity, ArrowLeft, CalendarClock, Code2, MessageSquare, Settings } from "lucide-react";
import { Tooltip } from "../display/Tooltip.js";
import navStyles from "./AppNav.module.scss";
import styles from "./ContextDetailShell.module.scss";

/** A single tab in the {@link ContextDetailShell} tab bar. */
export interface ContextDetailTab {
  /** Stable identifier used as the `activeTab` value. */
  id: string;
  /** Display label. */
  label: string;
  /** Icon element rendered before the label. */
  icon: ReactNode;
  /** Optional `data-testid` for the tab button. */
  testId?: string;
  /** When `"end"`, the tab is pinned to the right edge of the bar. */
  align?: "end";
}

/** Props for {@link ContextDetailShell}. */
export interface ContextDetailShellProps {
  /** Icon element displayed in the header (avatar, Lucide icon, etc.). */
  icon: ReactNode;
  /** Context name displayed next to the icon. */
  name: string;
  /** Navigate back (e.g. to the home page). */
  onNavigateBack: () => void;
  /** Optional content rendered below the name (e.g. heartbeat status). */
  statusContent?: ReactNode;
  /** Tabs rendered in the tab bar. */
  tabs: ContextDetailTab[];
  /** Identifier of the currently active tab. */
  activeTab: string;
  /** Called with a tab id when the user selects a tab. */
  onSelectTab: (tabId: string) => void;
  /** Accessible label for the tab bar (`aria-label`). Defaults to `"Navigation"`. */
  ariaLabel?: string;
  /** `data-testid` for the header element. */
  headerTestId?: string;
  /** `data-testid` for the tab bar `<nav>` element. */
  tabBarTestId?: string;
}

/**
 * Shared layout shell for context detail pages. Renders a header row
 * (back arrow, icon, name, optional status) followed by a horizontal
 * tab bar with keyboard navigation and end-alignment support.
 */
export function ContextDetailShell({
  icon,
  name,
  onNavigateBack,
  statusContent,
  tabs,
  activeTab,
  onSelectTab,
  ariaLabel = "Navigation",
  headerTestId,
  tabBarTestId,
}: ContextDetailShellProps): JSX.Element {
  const tabListRef = useRef<HTMLElement>(null);

  const orderedTabs = useMemo(
    () => [...tabs.filter((t) => t.align !== "end"), ...tabs.filter((t) => t.align === "end")],
    [tabs],
  );
  const firstEndAlignedId = orderedTabs.find((t) => t.align === "end")?.id;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      if (!buttons || buttons.length === 0) {
        return;
      }

      const focusedIndex = Array.from(buttons).findIndex((b) => b === document.activeElement);
      const currentIndex =
        focusedIndex >= 0 ? focusedIndex : orderedTabs.findIndex((t) => t.id === activeTab);
      let nextIndex = currentIndex;

      if (e.key === "ArrowRight" || e.key === "j" || e.key === "J") {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % orderedTabs.length;
      } else if (e.key === "ArrowLeft" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + orderedTabs.length) % orderedTabs.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIndex = orderedTabs.length - 1;
      } else {
        return;
      }

      onSelectTab(orderedTabs[nextIndex].id);
      buttons[nextIndex]?.focus(); // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- index may be out of bounds
    },
    [activeTab, onSelectTab, orderedTabs],
  );

  return (
    <>
      <header className={styles.header} data-testid={headerTestId}>
        <button
          type="button"
          className={styles.backButton}
          onClick={onNavigateBack}
          aria-label="Back"
          data-testid={headerTestId ? `${headerTestId}-back` : undefined}
        >
          <ArrowLeft size={18} />
        </button>
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
        <div className={styles.info}>
          <h2
            className={styles.name}
            data-testid={headerTestId ? `${headerTestId}-name` : undefined}
          >
            {name}
          </h2>
          {statusContent}
        </div>
      </header>
      <nav
        ref={tabListRef}
        className={navStyles.nav}
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        data-testid={tabBarTestId}
      >
        {orderedTabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const isFirstEndAligned = tab.id === firstEndAlignedId;
          return (
            <Tooltip
              key={tab.id}
              text={tab.label}
              placement="bottom"
              className={isFirstEndAligned ? navStyles.tabEnd : undefined}
            >
              <button
                role="tab"
                type="button"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={`${navStyles.tab} ${isActive ? navStyles.tabActive : ""}`}
                onClick={() => onSelectTab(tab.id)}
                data-testid={tab.testId}
                aria-label={tab.label}
              >
                <span className={navStyles.tabIcon} aria-hidden="true">
                  {tab.icon}
                </span>
                <span className={navStyles.tabLabel}>{tab.label}</span>
              </button>
            </Tooltip>
          );
        })}
      </nav>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pre-built tab arrays and icons for the two stock contexts (Code, Agent).
// Consumers pass these to ContextDetailShell to avoid duplicating lucide
// imports or re-defining the same tab lists.
// ---------------------------------------------------------------------------

const TAB_ICON_SIZE: number = 18;

/** Icon element for the Code context header (matches the ContextNav rail icon). */
export const CODE_HEADER_ICON: JSX.Element = <Code2 size={24} />;

/** Tab definitions for the Agent detail view, with Settings right-aligned. */
export const AGENT_DETAIL_TABS: ContextDetailTab[] = [
  {
    id: "chat",
    label: "Chat",
    icon: <MessageSquare size={TAB_ICON_SIZE} />,
    testId: "agent-tab-chat",
  },
  {
    id: "sessions",
    label: "Sessions",
    icon: <Activity size={TAB_ICON_SIZE} />,
    testId: "agent-tab-sessions",
  },
  {
    id: "schedules",
    label: "Schedules",
    icon: <CalendarClock size={TAB_ICON_SIZE} />,
    testId: "agent-tab-schedules",
  },
  {
    id: "settings",
    label: "Settings",
    icon: <Settings size={TAB_ICON_SIZE} />,
    testId: "agent-tab-settings",
    align: "end",
  },
];
