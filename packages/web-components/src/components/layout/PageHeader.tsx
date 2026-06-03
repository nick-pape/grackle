/**
 * PageHeader — standardized breadcrumb row with optional back-navigation and actions.
 *
 * @module
 */

import type { JSX, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { Breadcrumbs } from "../display/Breadcrumbs.js";
import type { BreadcrumbSegment } from "../../utils/breadcrumbs.js";
import { ICON_SM } from "../../utils/iconSize.js";
import styles from "./PageHeader.module.scss";

/** Props for {@link PageHeader}. */
export interface PageHeaderProps {
  /** Breadcrumb segments to render. */
  segments: BreadcrumbSegment[];
  /** Optional back-navigation label (e.g., "Home"). Renders ArrowLeft + label. */
  backLabel?: string;
  /** URL to navigate to when the back button is clicked. */
  backUrl?: string;
  /** Optional callback for back navigation (overrides backUrl if provided). */
  onNavigateBack?: () => void;
  /** Optional actions to render in the right slot. */
  actions?: ReactNode;
}

/** Standardized page header with breadcrumbs, optional back-navigation, and actions. */
export function PageHeader({
  segments,
  backLabel,
  backUrl,
  onNavigateBack,
  actions,
}: PageHeaderProps): JSX.Element {
  const showBack = Boolean(backUrl || onNavigateBack);

  return (
    <header className={styles.pageHeader} data-testid="page-header">
      {showBack && (
        <>
          {onNavigateBack ? (
            <button
              type="button"
              className={styles.backButton}
              onClick={onNavigateBack}
              aria-label={backLabel ? `Back to ${backLabel}` : "Back"}
              data-testid="page-header-back"
            >
              <ArrowLeft size={ICON_SM} />
              {backLabel && <span className={styles.backLabel}>{backLabel}</span>}
            </button>
          ) : backUrl ? (
            <Link
              to={backUrl}
              className={styles.backButton}
              aria-label={backLabel ? `Back to ${backLabel}` : "Back"}
              data-testid="page-header-back"
            >
              <ArrowLeft size={ICON_SM} />
              {backLabel && <span className={styles.backLabel}>{backLabel}</span>}
            </Link>
          ) : null}
          <span className={styles.backSeparator} aria-hidden="true">
            /
          </span>
        </>
      )}
      <Breadcrumbs segments={segments} />
      {actions && (
        <div className={styles.actions} data-testid="page-header-actions">
          {actions}
        </div>
      )}
    </header>
  );
}
