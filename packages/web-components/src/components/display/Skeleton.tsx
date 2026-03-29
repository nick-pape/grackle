import type { JSX } from "react";
import styles from "./Skeleton.module.scss";

// ─── Skeleton (base shimmer block) ───────────────────────────────────────────

/** Shape variant for the Skeleton component. */
type SkeletonVariant = "rectangular" | "circular";

/** Props for the {@link Skeleton} component. */
interface SkeletonProps {
  /** CSS width. Defaults to `"100%"`. */
  width?: string;
  /** CSS height. Defaults to `"1rem"`. */
  height?: string;
  /** CSS border-radius override. Ignored when `variant` is `"circular"`. */
  borderRadius?: string;
  /** Shape variant. `"circular"` forces 50% border-radius. Defaults to `"rectangular"`. */
  variant?: SkeletonVariant;
  /** Additional CSS class name. */
  className?: string;
}

/**
 * Animated shimmer placeholder that indicates loading content.
 * Renders a decorative `<div>` with a gradient sweep animation.
 */
export function Skeleton({
  width = "100%",
  height = "1rem",
  borderRadius,
  variant = "rectangular",
  className,
}: SkeletonProps): JSX.Element {
  const classNames = [
    styles.skeleton,
    variant === "circular" ? styles.circular : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={classNames}
      style={{
        width,
        height,
        ...(borderRadius && variant !== "circular" ? { borderRadius } : {}),
      }}
      aria-hidden="true"
      data-testid="skeleton"
    />
  );
}

// ─── SkeletonText (multi-line text placeholder) ──────────────────────────────

/** Props for the {@link SkeletonText} component. */
interface SkeletonTextProps {
  /** Number of text lines. Defaults to `3`. */
  lines?: number;
  /** Width of the last line. Defaults to `"60%"`. */
  lastLineWidth?: string;
  /** Height of each line. Defaults to `"0.75rem"`. */
  lineHeight?: string;
  /** Gap between lines. Defaults to `"var(--space-sm)"`. */
  gap?: string;
  /** Additional CSS class name. */
  className?: string;
}

/**
 * Multi-line skeleton text placeholder. Renders `lines` shimmer blocks
 * with the last line at a shorter width to simulate trailing text.
 */
export function SkeletonText({
  lines = 3,
  lastLineWidth = "60%",
  lineHeight = "0.75rem",
  gap = "var(--space-sm)",
  className,
}: SkeletonTextProps): JSX.Element {
  return (
    <div
      className={`${styles.textContainer} ${className ?? ""}`}
      style={{ gap }}
      aria-hidden="true"
      data-testid="skeleton-text"
    >
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 && lines > 1 ? lastLineWidth : "100%"}
          height={lineHeight}
        />
      ))}
    </div>
  );
}

// ─── SkeletonCard (card-shaped placeholder) ──────────────────────────────────

/** Props for the {@link SkeletonCard} component. */
interface SkeletonCardProps {
  /** Number of body text lines inside the card. Defaults to `2`. */
  lines?: number;
  /** Additional CSS class name. */
  className?: string;
}

/**
 * Card-shaped skeleton placeholder matching the standard card layout.
 * Contains a title-width shimmer block and body text lines.
 */
export function SkeletonCard({
  lines = 2,
  className,
}: SkeletonCardProps): JSX.Element {
  return (
    <div
      className={`${styles.card} ${className ?? ""}`}
      aria-hidden="true"
      data-testid="skeleton-card"
    >
      <Skeleton width="40%" height="1.25rem" />
      <SkeletonText lines={lines} />
    </div>
  );
}
