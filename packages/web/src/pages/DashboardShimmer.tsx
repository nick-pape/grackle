import type { JSX } from "react";
import { Skeleton } from "@grackle-ai/web-components";
import styles from "./DashboardPage.module.scss";

/** Shimmer placeholder for the DashboardPage while data loads. */
export function DashboardShimmer(): JSX.Element {
  return (
    <div className={styles.dashboard} aria-hidden="true">
      {/* KPI Strip */}
      <div className={styles.kpiStrip}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles.kpiCard}>
            <Skeleton width="3rem" height="2rem" />
            <Skeleton width="80%" height="0.75rem" />
          </div>
        ))}
      </div>

      {/* Body Grid */}
      <div className={styles.bodyGrid}>
        {/* Active Sessions section */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Skeleton width="1rem" height="1rem" variant="circular" />
            <Skeleton width="8rem" height="0.75rem" />
            <span className={styles.sectionCount}>
              <Skeleton width="1rem" height="0.75rem" />
            </span>
          </div>
          <div className={styles.sectionBody}>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className={styles.sessionRow} style={{ cursor: "default" }}>
                <Skeleton width="60%" height="0.875rem" />
                <Skeleton width="4rem" height="0.75rem" />
                <Skeleton width="3rem" height="0.75rem" />
                <Skeleton width="3rem" height="0.75rem" />
              </div>
            ))}
          </div>
        </div>

        {/* Needs Attention section */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Skeleton width="1rem" height="1rem" variant="circular" />
            <Skeleton width="8rem" height="0.75rem" />
            <span className={styles.sectionCount}>
              <Skeleton width="1rem" height="0.75rem" />
            </span>
          </div>
          <div className={styles.sectionBody}>
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className={styles.attentionRow} style={{ cursor: "default" }}>
                <div className={styles.attentionTitle}>
                  <Skeleton width="3rem" height="0.875rem" borderRadius="var(--radius-sm)" />
                  <Skeleton width="70%" height="0.875rem" />
                </div>
                <div className={styles.attentionMeta}>
                  <Skeleton width="5rem" height="0.625rem" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Grid */}
      <div className={styles.bottomGrid}>
        {/* Environment Health section */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Skeleton width="1rem" height="1rem" variant="circular" />
            <Skeleton width="9rem" height="0.75rem" />
            <span className={styles.sectionCount}>
              <Skeleton width="1rem" height="0.75rem" />
            </span>
          </div>
          <div className={styles.sectionBody}>
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className={styles.envRow}>
                <Skeleton width="60%" height="0.875rem" />
                <Skeleton width="4rem" height="0.875rem" borderRadius="var(--radius-sm)" />
              </div>
            ))}
          </div>
        </div>

        {/* Workspaces section */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Skeleton width="1rem" height="1rem" variant="circular" />
            <Skeleton width="6rem" height="0.75rem" />
            <span className={styles.sectionCount}>
              <Skeleton width="1rem" height="0.75rem" />
            </span>
          </div>
          <div className={styles.sectionBody}>
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className={styles.workspaceRow} style={{ cursor: "default" }}>
                <div className={styles.workspaceTop}>
                  <Skeleton width="50%" height="0.875rem" />
                  <Skeleton width="2rem" height="0.75rem" />
                </div>
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: "0%" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
