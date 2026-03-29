import type { JSX } from "react";
import { Skeleton, SkeletonCard } from "@grackle-ai/web-components";
import styles from "./EnvironmentDetailPage.module.scss";

/** Shimmer placeholder for the EnvironmentDetailPage while data loads. */
export function EnvironmentDetailShimmer(): JSX.Element {
  return (
    <div className={styles.container} aria-hidden="true">
      {/* Environment header */}
      <div className={styles.envHeader}>
        <div className={styles.envTitleRow}>
          <Skeleton width="0.875rem" height="0.875rem" variant="circular" />
          <Skeleton width="12rem" height="1.5rem" />
          <Skeleton width="4rem" height="0.875rem" />
        </div>
        <div className={styles.envMeta}>
          <Skeleton width="6rem" height="1.25rem" borderRadius="var(--radius-sm)" />
          <Skeleton width="5rem" height="1.25rem" borderRadius="var(--radius-sm)" />
          <Skeleton width="4.5rem" height="1.25rem" borderRadius="var(--radius-sm)" />
        </div>
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <Skeleton width="5rem" height="2rem" borderRadius="var(--radius-sm)" />
        <Skeleton width="4rem" height="2rem" borderRadius="var(--radius-sm)" />
      </div>

      {/* Workspaces section */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 style={{ margin: 0 }}>Workspaces</h3>
        </div>
        <div className={styles.cardList}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      </div>
    </div>
  );
}
