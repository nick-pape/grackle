import { useState, useRef, useEffect, type JSX } from "react";
import { EnvironmentList } from "../lists/EnvironmentList.js";
import { ProjectList } from "../lists/ProjectList.js";
import type { ViewMode } from "../../App.js";
import styles from "./Sidebar.module.scss";

/** Default sidebar width in pixels. */
const DEFAULT_SIDEBAR_WIDTH: number = 260;
/** Minimum sidebar width in pixels. */
const MIN_SIDEBAR_WIDTH: number = 180;
/** Maximum sidebar width in pixels. */
const MAX_SIDEBAR_WIDTH: number = 500;
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

/** Props for the Sidebar component. */
interface Props {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

type SidebarTab = "projects" | "environments";

/** Left sidebar with tabbed navigation between projects and environments. */
export function Sidebar({ viewMode, setViewMode }: Props): JSX.Element {
  const [tab, setTab] = useState<SidebarTab>("projects");
  const containerRef = useRef<HTMLDivElement>(null);

  /** Observe container resizes and persist width to localStorage. */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.round(entry.contentRect.width);
        if (width >= MIN_SIDEBAR_WIDTH && width <= MAX_SIDEBAR_WIDTH) {
          saveWidth(width);
        }
      }
    });

    observer.observe(element);
    return () => { observer.disconnect(); };
  }, []);

  return (
    <div className={styles.container} ref={containerRef} style={{ width: loadWidth() }}>
      {/* Tab bar */}
      <div className={styles.tabBar}>
        <button
          className={`${styles.tab} ${tab === "projects" ? styles.active : ""}`}
          onClick={() => setTab("projects")}
        >
          Projects
        </button>
        <button
          className={`${styles.tab} ${tab === "environments" ? styles.active : ""}`}
          onClick={() => setTab("environments")}
        >
          Environments
        </button>
      </div>

      {/* Content */}
      <div className={styles.content}>
        {tab === "projects" ? (
          <ProjectList viewMode={viewMode} setViewMode={setViewMode} />
        ) : (
          <EnvironmentList viewMode={viewMode} setViewMode={setViewMode} />
        )}
      </div>
    </div>
  );
}
