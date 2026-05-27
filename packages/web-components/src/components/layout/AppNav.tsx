import { useCallback, useMemo, useRef, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { useLocation } from "react-router";
import {
  Brain,
  ClipboardList,
  Home,
  MessageSquare,
  Monitor,
  Network,
  Settings,
} from "lucide-react";
import {
  CHAT_URL,
  COORDINATION_URL,
  ENVIRONMENTS_URL,
  HOME_URL,
  KNOWLEDGE_URL,
  SETTINGS_URL,
  SETTINGS_CREDENTIALS_URL,
  TASKS_URL,
  useAppNavigate,
} from "../../utils/navigation.js";
import { ICON_LG } from "../../utils/iconSize.js";
import { Tooltip } from "../display/Tooltip.js";
import styles from "./AppNav.module.scss";

/** Application view identifiers. */
export type AppView =
  | "dashboard"
  | "chat"
  | "tasks"
  | "environments"
  | "knowledge"
  | "coordination"
  | "settings";

/** Tab definition for the application navigation bar. */
export interface AppTab {
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
  /**
   * Display order within the nav bar (lower numbers appear first). Applied
   * across all plugins so tab order is explicit rather than dependent on plugin
   * load order. End-aligned tabs ignore this and are always pinned right.
   */
  order?: number;
  /** Horizontal alignment within the nav bar. `"end"` pins the tab to the right edge. */
  align?: "end";
}

/** Ordered list of all app navigation tabs. Exported for plugin registry use. */
export const TABS: AppTab[] = [
  {
    view: "dashboard",
    label: "Dashboard",
    icon: <Home size={ICON_LG} />,
    route: HOME_URL,
    testId: "sidebar-tab-dashboard",
    order: 0,
  },
  {
    view: "tasks",
    label: "Tasks",
    icon: <ClipboardList size={ICON_LG} />,
    route: TASKS_URL,
    testId: "sidebar-tab-tasks",
    order: 1,
  },
  {
    view: "environments",
    label: "Environments",
    icon: <Monitor size={ICON_LG} />,
    route: ENVIRONMENTS_URL,
    testId: "sidebar-tab-environments",
    order: 2,
  },
  {
    view: "chat",
    label: "Root",
    icon: <MessageSquare size={ICON_LG} />,
    route: CHAT_URL,
    testId: "sidebar-tab-chat",
    order: 3,
  },
  {
    view: "knowledge",
    label: "Knowledge",
    icon: <Brain size={ICON_LG} />,
    route: KNOWLEDGE_URL,
    testId: "sidebar-tab-knowledge",
    order: 5,
  },
  {
    view: "coordination",
    label: "Coordination",
    icon: <Network size={ICON_LG} />,
    route: COORDINATION_URL,
    testId: "sidebar-tab-coordination",
    order: 6,
  },
  {
    view: "settings",
    label: "Settings",
    icon: <Settings size={ICON_LG} />,
    route: SETTINGS_CREDENTIALS_URL,
    testId: "sidebar-tab-settings",
    align: "end",
  },
];

/** Derive the active application view from a URL pathname. */
export function getActiveView(pathname: string): AppView {
  if (pathname === HOME_URL || pathname === "/") {
    return "dashboard";
  }
  if (pathname.startsWith(COORDINATION_URL)) {
    return "coordination";
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
  if (pathname.startsWith(SETTINGS_URL)) {
    return "settings";
  }
  return "tasks";
}

/** Full-width navigation bar below the StatusBar for switching between app views. */
export function AppNav({ tabs = TABS }: { tabs?: AppTab[] }): JSX.Element {
  const location = useLocation();
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const activeView = getActiveView(location.pathname);

  // Sort by explicit `order`, then render end-aligned tabs (e.g. Settings) last
  // regardless of order, so they stay pinned to the right edge no matter which
  // plugins contribute tabs. Tabs without an `order` keep their incoming order
  // (stable sort) and fall after explicitly-ordered ones.
  const orderedTabs = useMemo(() => {
    const byOrder = (a: AppTab, b: AppTab): number =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    return [
      ...tabs.filter((t) => t.align !== "end").sort(byOrder),
      ...tabs.filter((t) => t.align === "end"),
    ];
  }, [tabs]);
  const firstEndAlignedView = orderedTabs.find((t) => t.align === "end")?.view;

  const handleClick = useCallback(
    (tab: AppTab) => {
      navigate(tab.route);
    },
    [navigate],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      if (!buttons) {
        return;
      }
      const focusedIndex = Array.from(buttons).findIndex((b) => b === document.activeElement);
      const currentIndex =
        focusedIndex >= 0 ? focusedIndex : orderedTabs.findIndex((t) => t.view === activeView);
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

      navigate(orderedTabs[nextIndex].route);
      buttons[nextIndex]?.focus(); // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- index may be out of bounds
    },
    [activeView, navigate, orderedTabs],
  );

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
      {orderedTabs.map((tab) => {
        const isActive = tab.view === activeView;
        const isFirstEndAligned = tab.view === firstEndAlignedView;
        return (
          <Tooltip
            key={tab.view}
            text={tab.label}
            placement="bottom"
            className={isFirstEndAligned ? styles.tabEnd : undefined}
          >
            <button
              role="tab"
              type="button"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              onClick={() => handleClick(tab)}
              data-testid={tab.testId}
              aria-label={tab.label}
            >
              <span className={styles.tabIcon} aria-hidden="true">
                {tab.icon}
              </span>
              <span className={styles.tabLabel}>{tab.label}</span>
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}
