import { useCallback, useMemo, useRef, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { useLocation } from "react-router";
import {
  Activity,
  Brain,
  ClipboardList,
  Home,
  MessageSquare,
  Monitor,
  Network,
  Settings,
  User,
} from "lucide-react";
import {
  CHAT_URL,
  COORDINATION_URL,
  ENVIRONMENTS_URL,
  HOME_URL,
  KNOWLEDGE_URL,
  PERSONAS_URL,
  SESSIONS_URL,
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
  | "personas"
  | "environments"
  | "sessions"
  | "knowledge"
  | "coordination"
  | "settings";

/**
 * Conceptual axis a nav tab belongs to, introduced with the context-axis
 * workbench shell (#1414). Tabs are grouped so the view bar can reason about
 * them by altitude rather than as one flat list:
 *
 * - `workbench` — the Code context's primary views (chat, sessions, tasks,
 *   knowledge, dashboard).
 * - `fleet` — cross-context overview surfaces (coordination). Relocated to a
 *   dedicated fleet altitude in #1415; rendered inline in the view bar for now.
 * - `global` — infrastructure / settings that sit outside the workbench
 *   (environments, settings); rendered as an end-aligned cluster.
 */
export type NavGroup = "workbench" | "global" | "fleet";

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
  /**
   * Conceptual axis this tab belongs to. Used by the shell to reason about tabs
   * by altitude (and, later, to relocate `fleet`/`global` tabs out of the view
   * bar). Optional so external tab lists keep working; defaults to `workbench`.
   */
  group?: NavGroup;
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
    group: "workbench",
  },
  {
    view: "tasks",
    label: "Tasks",
    icon: <ClipboardList size={ICON_LG} />,
    route: TASKS_URL,
    testId: "sidebar-tab-tasks",
    order: 1,
    group: "workbench",
  },
  {
    view: "personas",
    label: "Personas",
    icon: <User size={ICON_LG} />,
    route: PERSONAS_URL,
    testId: "sidebar-tab-personas",
    order: 1.5,
    group: "workbench",
  },
  {
    view: "chat",
    label: "Root",
    icon: <MessageSquare size={ICON_LG} />,
    route: CHAT_URL,
    testId: "sidebar-tab-chat",
    order: 3,
    group: "workbench",
  },
  {
    view: "sessions",
    label: "Sessions",
    icon: <Activity size={ICON_LG} />,
    route: SESSIONS_URL,
    testId: "sidebar-tab-sessions",
    order: 4,
    group: "workbench",
  },
  {
    view: "knowledge",
    label: "Knowledge",
    icon: <Brain size={ICON_LG} />,
    route: KNOWLEDGE_URL,
    testId: "sidebar-tab-knowledge",
    order: 5,
    group: "workbench",
  },
  {
    view: "coordination",
    label: "Coordination",
    icon: <Network size={ICON_LG} />,
    route: COORDINATION_URL,
    testId: "sidebar-tab-coordination",
    order: 6,
    group: "fleet",
  },
  // `global` infrastructure tabs are pinned to the right edge (`align: "end"`)
  // so they read as a cluster separate from the workbench views. Environments
  // moved here from the workbench row as part of the context-axis reframing
  // (#1414); the page itself is unchanged and still fully reachable.
  {
    view: "environments",
    label: "Environments",
    icon: <Monitor size={ICON_LG} />,
    route: ENVIRONMENTS_URL,
    testId: "sidebar-tab-environments",
    align: "end",
    group: "global",
  },
  {
    view: "settings",
    label: "Settings",
    icon: <Settings size={ICON_LG} />,
    route: SETTINGS_CREDENTIALS_URL,
    testId: "sidebar-tab-settings",
    align: "end",
    group: "global",
  },
];

/** Derive the active application view from a URL pathname. */
export function getActiveView(pathname: string): AppView {
  if (pathname === HOME_URL || pathname === "/") {
    return "dashboard";
  }
  if (pathname.startsWith(PERSONAS_URL)) {
    return "personas";
  }
  if (pathname.startsWith(COORDINATION_URL)) {
    return "coordination";
  }
  if (pathname.startsWith(SESSIONS_URL)) {
    return "sessions";
  }
  if (pathname.startsWith("/chat")) {
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

/** Props for the {@link AppNav} component. */
export interface AppNavProps {
  /** Tabs to render. Defaults to the canonical {@link TABS}. */
  tabs?: AppTab[];
  /**
   * When provided, only tabs whose {@link AppTab.group} is in this list are
   * rendered (tabs without a `group` are treated as `workbench`). Omit to
   * render every tab. This is the lever the fleet/overview relocation (#1415)
   * uses to pull `fleet` tabs out of the view bar without changing `TABS`.
   */
  groups?: NavGroup[];
}

/** Full-width navigation bar below the StatusBar for switching between app views. */
export function AppNav({ tabs = TABS, groups }: AppNavProps): JSX.Element {
  const location = useLocation();
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const activeView = getActiveView(location.pathname);

  // Sort by explicit `order`, then render end-aligned tabs (e.g. Settings) last
  // regardless of order, so they stay pinned to the right edge no matter which
  // plugins contribute tabs. Tabs without an `order` keep their incoming order
  // (stable sort) and fall after explicitly-ordered ones. When `groups` is set,
  // restrict to those axes first (a missing `group` counts as `workbench`).
  const orderedTabs = useMemo(() => {
    const byOrder = (a: AppTab, b: AppTab): number =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    const visible =
      groups === undefined ? tabs : tabs.filter((t) => groups.includes(t.group ?? "workbench"));
    return [
      ...visible.filter((t) => t.align !== "end").sort(byOrder),
      ...visible.filter((t) => t.align === "end"),
    ];
  }, [tabs, groups]);
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
