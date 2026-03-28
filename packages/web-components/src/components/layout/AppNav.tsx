import { useCallback, useRef, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { useLocation } from "react-router";
import { Brain, ClipboardList, Home, MessageSquare, Monitor, Search, Settings } from "lucide-react";
import { CHAT_URL, ENVIRONMENTS_URL, FINDINGS_URL, HOME_URL, KNOWLEDGE_URL, SETTINGS_URL, SETTINGS_CREDENTIALS_URL, TASKS_URL, useAppNavigate } from "../../utils/navigation.js";
import { ICON_LG } from "../../utils/iconSize.js";
import styles from "./AppNav.module.scss";

/** Application view identifiers. */
export type AppView = "dashboard" | "chat" | "tasks" | "environments" | "knowledge" | "findings" | "settings";

/** Tab definition for the application navigation bar. */
interface AppTab {
  /** View identifier. */
  view: AppView;
  /** Display label. */
  label: string;
  /** Icon element displayed before the label. */
  icon: ReactNode;
  /** Route to navigate to when clicked. */
  route: string;
  /** data-testid suffix. */
  testId: string;
}

/** Ordered list of app navigation tabs. */
const TABS: AppTab[] = [
  { view: "dashboard", label: "Dashboard", icon: <Home size={ICON_LG} />, route: HOME_URL, testId: "sidebar-tab-dashboard" },
  { view: "chat", label: "Chat", icon: <MessageSquare size={ICON_LG} />, route: CHAT_URL, testId: "sidebar-tab-chat" },
  { view: "tasks", label: "Tasks", icon: <ClipboardList size={ICON_LG} />, route: TASKS_URL, testId: "sidebar-tab-tasks" },
  { view: "environments", label: "Environments", icon: <Monitor size={ICON_LG} />, route: ENVIRONMENTS_URL, testId: "sidebar-tab-environments" },
  { view: "knowledge", label: "Knowledge", icon: <Brain size={ICON_LG} />, route: KNOWLEDGE_URL, testId: "sidebar-tab-knowledge" },
  { view: "findings", label: "Findings", icon: <Search size={ICON_LG} />, route: FINDINGS_URL, testId: "sidebar-tab-findings" },
  { view: "settings", label: "Settings", icon: <Settings size={ICON_LG} />, route: SETTINGS_CREDENTIALS_URL, testId: "sidebar-tab-settings" },
];

/** Derive the active application view from a URL pathname. */
export function getActiveView(pathname: string): AppView {
  if (pathname === HOME_URL || pathname === "/") {
    return "dashboard";
  }
  if (pathname.startsWith("/chat") || pathname.startsWith("/sessions")) {
    return "chat";
  }
  if (pathname.startsWith("/workspaces") || pathname.startsWith("/environments")) {
    return "environments";
  }
  if (pathname.startsWith(KNOWLEDGE_URL)) {
    return "knowledge";
  }
  if (pathname.startsWith(FINDINGS_URL)) {
    return "findings";
  }
  if (pathname.startsWith(SETTINGS_URL)) {
    return "settings";
  }
  return "tasks";
}

/** Full-width navigation bar below the StatusBar for switching between app views. */
export function AppNav(): JSX.Element {
  const location = useLocation();
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const activeView = getActiveView(location.pathname);

  const handleClick = useCallback((tab: AppTab) => {
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

    if (e.key === "ArrowRight" || e.key === "j" || e.key === "J") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (e.key === "ArrowLeft" || e.key === "k" || e.key === "K") {
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
      aria-label="App navigation"
      onKeyDown={handleKeyDown}
      data-testid="sidebar-nav"
    >
      {TABS.map((tab) => {
        const isActive = tab.view === activeView;
        return (
          <button
            key={tab.view}
            role="tab"
            type="button"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
            onClick={() => handleClick(tab)}
            data-testid={tab.testId}
            title={tab.label}
            aria-label={tab.label}
          >
            <span className={styles.tabIcon} aria-hidden="true">{tab.icon}</span>
            <span className={styles.tabLabel}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
