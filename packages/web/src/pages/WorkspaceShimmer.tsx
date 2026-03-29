import type { JSX } from "react";
import { Skeleton, SkeletonCard } from "@grackle-ai/web-components";
import styles from "./page-layout.module.scss";

/** Shimmer placeholder for the WorkspacePage while data loads. */
export function WorkspaceShimmer(): JSX.Element {
  return (
    <div className={styles.panelContainer} aria-hidden="true">
      {/* Workspace header */}
      <div className={styles.workspaceHeader}>
        <span className={styles.workspaceName}>
          <Skeleton width="12rem" height="1.25rem" />
        </span>
      </div>

      {/* Meta toggle placeholder */}
      <div className={styles.metaToggle} style={{ cursor: "default" }}>
        <Skeleton width="4rem" height="0.625rem" />
      </div>

      {/* Progress bar placeholder */}
      <div className={styles.progressBarContainer}>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: "0%" }} />
        </div>
        <Skeleton width="2rem" height="0.625rem" />
      </div>

      {/* Tab bar with real labels */}
      <div className={styles.tabBar} role="tablist" aria-label="Workspace view">
        <span className={`${styles.tab} ${styles.active}`}>Graph</span>
        <span className={styles.tab}>Board</span>
        <span className={styles.tab}>Tasks</span>
      </div>

      {/* Content area: skeleton cards */}
      <div className={styles.overviewContent}>
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonCard key={i} lines={2} />
        ))}
      </div>
    </div>
  );
}
