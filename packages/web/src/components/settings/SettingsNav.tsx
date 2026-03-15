import { useCallback, useRef, type JSX, type KeyboardEvent } from "react";
import { useLocation } from "react-router";
import { useAppNavigate } from "../../utils/navigation.js";
import styles from "./SettingsNav.module.scss";

/** Tab definition for the settings navigation rail. */
interface SettingsTab {
  /** URL path segment (appended to /settings/). */
  path: string;
  /** Display label for the tab. */
  label: string;
  /** Icon character displayed before the label. */
  icon: string;
}

/** Ordered list of settings tabs. */
const TABS: SettingsTab[] = [
  { path: "environments", label: "Environments", icon: "\uD83D\uDDA5\uFE0F" },
  { path: "tokens", label: "Tokens", icon: "\uD83D\uDD11" },
  { path: "personas", label: "Personas", icon: "\uD83D\uDC64" },
  { path: "appearance", label: "Appearance", icon: "\uD83C\uDFA8" },
  { path: "about", label: "About", icon: "\u2139\uFE0F" },
];

/** Vertical tab navigation rail for the settings hub. */
export function SettingsNav(): JSX.Element {
  const location = useLocation();
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLDivElement>(null);

  const activeTab = TABS.find((t) => location.pathname === `/settings/${t.path}`)?.path ?? TABS[0].path;

  const handleClick = useCallback((path: string) => {
    navigate(`/settings/${path}`);
  }, [navigate]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    // Derive current index from the focused element rather than location
    // to avoid stale closures during rapid keyboard navigation.
    const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    if (!buttons) {
      return;
    }
    const focusedIndex = Array.from(buttons).findIndex((b) => b === document.activeElement);
    const currentIndex = focusedIndex >= 0 ? focusedIndex : TABS.findIndex((t) => t.path === activeTab);
    let nextIndex = currentIndex;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (e.key === "ArrowUp") {
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

    const nextPath = TABS[nextIndex].path;
    navigate(`/settings/${nextPath}`);
    buttons[nextIndex]?.focus();
  }, [activeTab, navigate]);

  return (
    <nav
      className={styles.nav}
      ref={tabListRef}
      role="tablist"
      aria-orientation="vertical"
      aria-label="Settings"
      onKeyDown={handleKeyDown}
    >
      {TABS.map((tab) => {
        const isActive = tab.path === activeTab;
        return (
          <button
            key={tab.path}
            role="tab"
            type="button"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
            onClick={() => handleClick(tab.path)}
          >
            <span className={styles.tabIcon}>{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
