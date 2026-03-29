import type { JSX } from "react";
import { Skeleton, SkeletonText } from "@grackle-ai/web-components";
import styles from "./page-layout.module.scss";

/** Shimmer placeholder for the TaskPage while data loads. */
export function TaskShimmer(): JSX.Element {
  return (
    <div className={styles.panelContainer} aria-hidden="true">
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>
          <Skeleton width="12rem" height="1rem" />
          <Skeleton width="4rem" height="1rem" borderRadius="var(--radius-full)" />
        </span>
      </div>

      {/* Tab bar with real labels */}
      <div className={styles.tabBar} role="tablist" aria-label="Task view">
        <span className={`${styles.tab} ${styles.active}`}>Overview</span>
        <span className={styles.tab}>Stream</span>
        <span className={styles.tab}>Findings</span>
      </div>

      {/* Overview content */}
      <div className={styles.overviewContent}>
        <div className={styles.overviewDashboard}>
          {/* Hero: status badge skeleton */}
          <div className={styles.overviewHero}>
            <Skeleton width="5rem" height="1.5rem" borderRadius="var(--radius-full)" />
          </div>

          {/* Description section */}
          <div className={styles.overviewSection}>
            <div className={styles.overviewLabel}>Description</div>
            <SkeletonText lines={2} />
          </div>

          {/* Environment section */}
          <div className={styles.overviewSection}>
            <div className={styles.overviewLabel}>Environment</div>
            <div className={styles.envRow}>
              <Skeleton width="0.5rem" height="0.5rem" variant="circular" />
              <Skeleton width="8rem" height="0.875rem" />
            </div>
          </div>

          {/* Dependencies section */}
          <div className={styles.overviewSection}>
            <div className={styles.overviewLabel}>Dependencies</div>
            <SkeletonText lines={2} />
          </div>

          {/* Timeline section */}
          <div className={styles.overviewSection}>
            <div className={styles.overviewLabel}>Timeline</div>
            <div className={styles.timeline}>
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className={styles.timelineRow}>
                  <Skeleton width="4rem" height="0.75rem" />
                  <Skeleton width="10rem" height="0.75rem" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
