import { useState, useRef, useEffect, type JSX } from "react";
import { useLocation } from "react-router";
import { getActiveView } from "./AppNav.js";
import { TaskList } from "../lists/TaskList.js";
import { WorkspaceList } from "../lists/WorkspaceList.js";
import { SettingsNav } from "../settings/SettingsNav.js";
import styles from "./Sidebar.module.scss";

/** Default sidebar width in pixels. */
const DEFAULT_SIDEBAR_WIDTH: number = 320;
/** Minimum sidebar width in pixels. */
const MIN_SIDEBAR_WIDTH: number = 220;
/** Maximum sidebar width in pixels. */
const MAX_SIDEBAR_WIDTH: number = 600;
/** localStorage key for persisted sidebar width. */
const STORAGE_KEY: string = "grackle-sidebar-width";

/** Read persisted sidebar width from localStorage, falling back to the default. */
function loadWidth(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
        return parsed;
      }
    }
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

/** Persist sidebar width to localStorage. */
function saveWidth(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // localStorage unavailable
  }
}

/** Left sidebar showing view-specific content based on the active app navigation tab. */
export function Sidebar(): JSX.Element {
  const [width] = useState<number>(loadWidth);
  const containerRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const activeView = getActiveView(location.pathname);

  /** Observe container resizes and persist width to localStorage. */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const borderBox = entry.borderBoxSize[0];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- borderBoxSize[0] may be undefined in some browsers
        if (borderBox) {
          const boxWidth = Math.round(borderBox.inlineSize);
          if (boxWidth >= MIN_SIDEBAR_WIDTH && boxWidth <= MAX_SIDEBAR_WIDTH) {
            saveWidth(boxWidth);
          }
        }
      }
    });

    observer.observe(element);
    return () => { observer.disconnect(); };
  }, []);

  return (
    <div className={styles.container} ref={containerRef} data-testid="sidebar" style={{ width }}>
      <div className={styles.content}>
        {activeView === "tasks" && <TaskList />}
        {activeView === "workspaces" && <WorkspaceList />}
        {activeView === "settings" && <SettingsNav />}
      </div>
    </div>
  );
}
