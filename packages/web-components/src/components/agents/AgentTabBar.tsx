/**
 * AgentTabBar — presentational tab bar for the agent detail page (#1419).
 * Renders Chat / Sessions / Schedules / Settings tabs, reusing AppNav styling.
 *
 * @module
 */

import { useRef, type JSX, type KeyboardEvent } from "react";
import { Activity, CalendarClock, MessageSquare, Settings } from "lucide-react";
import { useAppNavigate, agentUrl, type AgentTab } from "../../utils/navigation.js";
import navStyles from "../layout/AppNav.module.scss";

const ICON_SIZE: number = 18;

interface AgentTabDef {
  id: AgentTab;
  label: string;
  icon: JSX.Element;
}

const AGENT_TABS: AgentTabDef[] = [
  { id: "chat", label: "Chat", icon: <MessageSquare size={ICON_SIZE} /> },
  { id: "sessions", label: "Sessions", icon: <Activity size={ICON_SIZE} /> },
  { id: "schedules", label: "Schedules", icon: <CalendarClock size={ICON_SIZE} /> },
  { id: "settings", label: "Settings", icon: <Settings size={ICON_SIZE} /> },
];

/** Props for {@link AgentTabBar}. */
export interface AgentTabBarProps {
  /** The agent whose tabs are being rendered. */
  agentId: string;
  /** Which tab is currently active. */
  activeTab: AgentTab;
}

/** Horizontal tab bar for navigating between agent detail views. */
export function AgentTabBar({ agentId, activeTab }: AgentTabBarProps): JSX.Element {
  const navigate = useAppNavigate();
  const navRef = useRef<HTMLElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    const buttons = navRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    if (!buttons || buttons.length === 0) return;

    const currentIndex = AGENT_TABS.findIndex((t) => t.id === activeTab);
    let nextIndex = currentIndex;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % AGENT_TABS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + AGENT_TABS.length) % AGENT_TABS.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      nextIndex = AGENT_TABS.length - 1;
    } else {
      return;
    }

    const nextTab = AGENT_TABS[nextIndex];
    navigate(agentUrl(agentId, nextTab.id));
    buttons[nextIndex].focus();
  };

  return (
    <nav
      ref={navRef}
      className={navStyles.nav}
      role="tablist"
      aria-label="Agent navigation"
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      data-testid="agent-tab-bar"
    >
      {AGENT_TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`${navStyles.tab} ${isActive ? navStyles.tabActive : ""}`}
            onClick={() => navigate(agentUrl(agentId, tab.id))}
            data-testid={`agent-tab-${tab.id}`}
          >
            <span className={navStyles.tabIcon}>{tab.icon}</span>
            <span className={navStyles.tabLabel}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
