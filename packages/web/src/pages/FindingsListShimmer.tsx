import type { JSX } from "react";
import { SkeletonCard } from "@grackle-ai/web-components";
import styles from "./FindingsListPage.module.scss";

/** Shimmer placeholder for the FindingsListPage while data loads. */
export function FindingsListShimmer(): JSX.Element {
  return (
    <div className={styles.container} aria-hidden="true">
      <h1 className={styles.title}>Findings</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} lines={3} />
        ))}
      </div>
    </div>
  );
}
