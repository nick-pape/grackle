import { useCallback, useRef, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { useLocation } from "react-router";
import { CalendarClock, Github, Info, Key, Keyboard, Palette, Puzzle, User } from "lucide-react";
import { SETTINGS_URL, useAppNavigate } from "../../utils/navigation.js";
import { ICON_LG } from "../../utils/iconSize.js";
import styles from "./SettingsNav.module.scss";

/** Tab definition for the settings navigation rail. */
interface SettingsTab {
  /** URL path segment (appended to /settings/). */
  path: string;
  /** Display label for the tab. */
  label: string;
  /** Icon element displayed before the label. */
  icon: ReactNode;
}

/** Ordered list of settings tabs. */
const TABS: SettingsTab[] = [
  { path: "credentials", label: "Credentials", icon: <Key size={ICON_LG} /> },
  { path: "github-accounts", label: "GitHub", icon: <Github size={ICON_LG} /> },
  { path: "personas", label: "Personas", icon: <User size={ICON_LG} /> },
  { path: "schedules", label: "Schedules", icon: <CalendarClock size={ICON_LG} /> },
  { path: "appearance", label: "Appearance", icon: <Palette size={ICON_LG} /> },
  { path: "shortcuts", label: "Shortcuts", icon: <Keyboard size={ICON_LG} /> },
  { path: "plugins", label: "Plugins", icon: <Puzzle size={ICON_LG} /> },
  { path: "about", label: "About", icon: <Info size={ICON_LG} /> },
];

/** Vertical tab navigation rail for the settings hub. */
export function SettingsNav(): JSX.Element {
  const location = useLocation();
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const activeTab = TABS.find((tab) => {
    const tabPath = `${SETTINGS_URL}/${tab.path}`;
    return location.pathname === tabPath || location.pathname.startsWith(`${tabPath}/`);
  })?.path ?? TABS[0].path;

  const handleClick = useCallback((path: string) => {
    navigate(`${SETTINGS_URL}/${path}`);
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

    if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
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
    navigate(`${SETTINGS_URL}/${nextPath}`);
    buttons[nextIndex]?.focus(); // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- index may be out of bounds
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
            <span className={styles.tabIcon} aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
