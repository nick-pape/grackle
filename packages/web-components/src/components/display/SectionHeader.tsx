/**
 * SectionHeader -- shared uppercase section label with optional icon-button actions.
 *
 * Used atop every sidebar nav (Tasks, Environments, Schedules, Personas, Coordination)
 * to provide a consistent header strip. Actions (filter, group, sort, add, etc.) only
 * render when provided.
 *
 * @module
 */

import { type JSX, type ReactNode } from "react";
import { Tooltip } from "./Tooltip.js";
import styles from "./SectionHeader.module.scss";

/** A single action button rendered in the SectionHeader trailing slot. */
export interface SectionHeaderAction {
  /** Unique key for React rendering. */
  key: string;
  /** Icon element (typically a lucide-react component). */
  icon: ReactNode;
  /** Tooltip text shown on hover. */
  tooltip: string;
  /** Accessible label for the button. */
  ariaLabel: string;
  /** Click handler. */
  onClick: () => void;
  /** Whether this action is currently active (renders with green accent). */
  active?: boolean;
  /** aria-pressed value for toggle buttons. */
  ariaPressed?: boolean;
  /** Optional data-testid for the button. */
  testId?: string;
}

/** Props for the {@link SectionHeader} component. */
export interface SectionHeaderProps {
  /** Section title text (rendered uppercase via section-label mixin). */
  title: string;
  /** Optional action buttons rendered in the trailing slot. Only renders the actions container when non-empty. */
  actions?: SectionHeaderAction[];
  /** Optional data-testid for the header root. */
  "data-testid"?: string;
}

/** Uppercase section label with optional trailing icon-button actions. */
export function SectionHeader({
  title,
  actions,
  "data-testid": testId,
}: SectionHeaderProps): JSX.Element {
  const hasActions = actions !== undefined && actions.length > 0;
  return (
    <div className={styles.header} data-testid={testId}>
      <span className={styles.title}>{title}</span>
      {hasActions && (
        <div className={styles.actions}>
          {actions.map((action) => (
            <Tooltip key={action.key} text={action.tooltip}>
              <button
                type="button"
                className={`${styles.actionButton} ${action.active ? styles.actionActive : ""}`}
                onClick={action.onClick}
                aria-label={action.ariaLabel}
                aria-pressed={action.ariaPressed}
                data-testid={action.testId}
              >
                {action.icon}
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
