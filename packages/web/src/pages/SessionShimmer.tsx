import type { JSX } from "react";
import { Skeleton } from "@grackle-ai/web-components";
import styles from "./page-layout.module.scss";

/** Shimmer placeholder for the SessionPage while data loads. */
export function SessionShimmer(): JSX.Element {
  return (
    <div className={styles.panelContainer} aria-hidden="true">
      {/* Header */}
      <div className={styles.header}>
        <span>
          <Skeleton width="10rem" height="0.875rem" />
        </span>
        <span className={styles.headerInfo}>
          <Skeleton width="16rem" height="0.875rem" />
        </span>
      </div>

      {/* Event stream area: varying-height skeleton blocks */}
      <div className={styles.eventScroll}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <Skeleton width="70%" height="2.5rem" borderRadius="var(--radius-sm)" />
          <Skeleton width="90%" height="4rem" borderRadius="var(--radius-sm)" />
          <Skeleton width="50%" height="2rem" borderRadius="var(--radius-sm)" />
          <Skeleton width="80%" height="3.5rem" borderRadius="var(--radius-sm)" />
          <Skeleton width="60%" height="2.5rem" borderRadius="var(--radius-sm)" />
        </div>
      </div>
    </div>
  );
}
