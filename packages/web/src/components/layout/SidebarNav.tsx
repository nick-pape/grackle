import { useCallback, useRef, type JSX, type KeyboardEvent } from "react";
import { useLocation } from "react-router";
import { SETTINGS_URL, useAppNavigate } from "../../utils/navigation.js";
import styles from "./SidebarNav.module.scss";

/** Sidebar view identifiers. */
export type SidebarView = "tasks" | "workspaces" | "settings";

/** Tab definition for the sidebar navigation bar. */
interface SidebarTab {
  /** View identifier. */
  view: SidebarView;
  /** Display label (omit for icon-only tabs). */
  label?: string;
  /** Icon character displayed before the label. */
  icon?: string;
  /** Route to navigate to when clicked. */
  route: string;
  /** data-testid suffix. */
  testId: string;
}

/** Ordered list of sidebar tabs. */
const TABS: SidebarTab[] = [
  { view: "tasks", label: "Tasks", route: "/tasks", testId: "sidebar-tab-tasks" },
  { view: "workspaces", label: "Workspaces", route: "/workspaces", testId: "sidebar-tab-workspaces" },
  { view: "settings", icon: "\u2699", route: `${SETTINGS_URL}/environments`, testId: "sidebar-tab-settings" },
];

/** Derive the active sidebar view from a URL pathname. */
export function getActiveView(pathname: string): SidebarView {
  if (pathname.startsWith("/workspaces")) {
    return "workspaces";
  }
  if (pathname.startsWith(SETTINGS_URL)) {
    return "settings";
  }
  return "tasks";
}

/** Horizontal tab bar for switching between Tasks, Workspaces, and Settings sidebar views. */
export function SidebarNav(): JSX.Element {
  const location = useLocation();
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const activeView = getActiveView(location.pathname);

  const handleClick = useCallback((tab: SidebarTab) => {
    navigate(tab.route);
  }, [navigate]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    if (!buttons) {
      return;
    }
    const focusedIndex = Array.from(buttons).findIndex((b) => b === document.activeElement);
    const currentIndex = focusedIndex >= 0 ? focusedIndex : TABS.findIndex((t) => t.view === activeView);
    let nextIndex = currentIndex;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      nextIndex = TABS.length - 1;
    } else {
      return;
    }

    navigate(TABS[nextIndex].route);
    buttons[nextIndex]?.focus(); // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- index may be out of bounds
  }, [activeView, navigate]);

  return (
    <nav
      className={styles.nav}
      ref={tabListRef}
      role="tablist"
      aria-orientation="horizontal"
      aria-label="Sidebar navigation"
      onKeyDown={handleKeyDown}
      data-testid="sidebar-nav"
    >
      {TABS.map((tab) => {
        const isActive = tab.view === activeView;
        const isSettings = tab.view === "settings";
        return (
          <button
            key={tab.view}
            role="tab"
            type="button"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`${styles.tab} ${isActive ? styles.tabActive : ""} ${isSettings ? styles.settingsTab : ""}`}
            onClick={() => handleClick(tab)}
            data-testid={tab.testId}
            title={tab.label ?? "Settings"}
            aria-label={tab.label ?? "Settings"}
          >
            {tab.icon && <span aria-hidden="true">{tab.icon}</span>}
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
