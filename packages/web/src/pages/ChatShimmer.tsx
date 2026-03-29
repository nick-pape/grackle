import type { JSX } from "react";
import { Skeleton } from "@grackle-ai/web-components";
import styles from "./ChatPage.module.scss";

/** Shimmer placeholder for the ChatPage while data loads. */
export function ChatShimmer(): JSX.Element {
  return (
    <div className={styles.panelContainer} aria-hidden="true">
      {/* Event stream message placeholders */}
      <div style={{ flex: 1, overflow: "hidden", padding: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        <Skeleton width="65%" height="2.5rem" borderRadius="var(--radius-sm)" />
        <Skeleton width="85%" height="4rem" borderRadius="var(--radius-sm)" />
        <Skeleton width="45%" height="2rem" borderRadius="var(--radius-sm)" />
        <Skeleton width="75%" height="3rem" borderRadius="var(--radius-sm)" />
        <Skeleton width="55%" height="2.5rem" borderRadius="var(--radius-sm)" />
      </div>
    </div>
  );
}
