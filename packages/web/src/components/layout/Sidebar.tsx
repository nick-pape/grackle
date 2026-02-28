import { useState, type JSX } from "react";
import { EnvironmentList } from "../lists/EnvironmentList.js";
import { ProjectList } from "../lists/ProjectList.js";
import type { ViewMode } from "../../App.js";
import styles from "./Sidebar.module.scss";

/** Props for the Sidebar component. */
interface Props {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

type SidebarTab = "projects" | "environments";

/** Left sidebar with tabbed navigation between projects and environments. */
export function Sidebar({ viewMode, setViewMode }: Props): JSX.Element {
  const [tab, setTab] = useState<SidebarTab>("projects");

  return (
    <div className={styles.container}>
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
