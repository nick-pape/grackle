import type { JSX } from "react";
import type { BreadcrumbSegment } from "../../utils/breadcrumbs.js";
import styles from "./Breadcrumbs.module.scss";

/** Props for the Breadcrumbs component. */
interface BreadcrumbsProps {
  segments: BreadcrumbSegment[];
  onNavigate: (segment: BreadcrumbSegment) => void;
}

/** Separator character between breadcrumb segments. */
const SEPARATOR: string = "\u203A"; // ›

/** Renders a clickable breadcrumb trail from a list of segments. */
export function Breadcrumbs({ segments, onNavigate }: BreadcrumbsProps): JSX.Element {
  return (
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb" data-testid="breadcrumbs">
      <ol className={styles.list}>
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          return (
            <li key={index} className={styles.item}>
              {index > 0 && (
                <span className={styles.separator} aria-hidden="true">
                  {SEPARATOR}
                </span>
              )}
              {segment.viewMode && !isLast ? (
                <button
                  className={styles.link}
                  onClick={() => onNavigate(segment)}
                  title={segment.label}
                >
                  {segment.label}
                </button>
              ) : (
                <span className={styles.current} aria-current="page" title={segment.label}>
                  {segment.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
