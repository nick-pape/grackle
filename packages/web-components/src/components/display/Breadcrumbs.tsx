import type { JSX } from "react";
import { Link } from "react-router";
import type { BreadcrumbSegment } from "../../utils/breadcrumbs.js";
import styles from "./Breadcrumbs.module.scss";

/** Props for the Breadcrumbs component. */
interface BreadcrumbsProps {
  segments: BreadcrumbSegment[];
}

/** Separator character between breadcrumb segments. */
const SEPARATOR: string = "\u203A"; // ›

/** Renders a clickable breadcrumb trail from a list of segments. */
export function Breadcrumbs({ segments }: BreadcrumbsProps): JSX.Element {
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
              {segment.url && !isLast ? (
                <Link
                  className={styles.link}
                  to={segment.url}
                  title={segment.label}
                >
                  {segment.label}
                </Link>
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
