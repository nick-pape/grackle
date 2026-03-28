import type { JSX } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import type { BreadcrumbSegment } from "../../utils/breadcrumbs.js";
import { ICON_SM } from "../../utils/iconSize.js";
import styles from "./Breadcrumbs.module.scss";

/** Props for the Breadcrumbs component. */
interface BreadcrumbsProps {
  segments: BreadcrumbSegment[];
}

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
                  <ChevronRight size={ICON_SM} />
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
