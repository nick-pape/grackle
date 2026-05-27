import type { JSX } from "react";
import {
  type SkeletonBuiltinProps,
  type SkeletonTextBuiltinProps,
  type SkeletonCardBuiltinProps,
} from "@grackle-ai/common";
import styles from "./Skeleton.module.scss";

// ─── Skeleton (base shimmer block) ───────────────────────────────────────────

// Data props (width/height/borderRadius/variant, line counts) are inferred from
// the built-ins' zod schemas in @grackle-ai/common so the GenUX catalog can't
// drift from these components; `className` is the only styling-hook extra.

/** Props for the {@link Skeleton} component. */
interface SkeletonProps extends SkeletonBuiltinProps {
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
  ]
    .filter(Boolean)
    .join(" ");

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
interface SkeletonTextProps extends SkeletonTextBuiltinProps {
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
interface SkeletonCardProps extends SkeletonCardBuiltinProps {
  /** Additional CSS class name. */
  className?: string;
}

/**
 * Card-shaped skeleton placeholder matching the standard card layout.
 * Contains a title-width shimmer block and body text lines.
 */
export function SkeletonCard({ lines = 2, className }: SkeletonCardProps): JSX.Element {
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
