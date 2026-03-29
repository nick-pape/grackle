/**
 * Wrapper component for events in the EventStream that provides:
 * - Hover action row (Copy + Select) in normal mode
 * - Checkbox + full-row click target in selection mode
 *
 * Pure presentational component -- no useGrackle().
 */

import { useState, useCallback, type JSX, type ReactNode } from "react";
import { Clipboard, Check, CheckSquare } from "lucide-react";
import { ICON_SM } from "../../utils/iconSize.js";
import styles from "./EventHoverRow.module.scss";

/** Props for the EventHoverRow component. */
export interface EventHoverRowProps {
  /** Text to copy when the hover Copy button is clicked. */
  copyText: string;
  /** Whether this event has copyable content (shows hover actions). */
  isContentBearing: boolean;
  /** Whether multi-select mode is active. */
  isSelecting: boolean;
  /** Whether this event is currently selected in multi-select mode. */
  isSelected: boolean;
  /** Called when the Select button in the hover row is clicked (enters selection mode). */
  onSelect: () => void;
  /** Called when the row is clicked in selection mode. Receives the shiftKey state. */
  onToggle: (shiftKey: boolean) => void;
  /** Called after a successful single-event copy from the hover row. */
  onCopied?: () => void;
  /** The event content to wrap. */
  children: ReactNode;
}

/**
 * Wraps an event in the EventStream with hover actions (normal mode) or
 * selection affordances (multi-select mode).
 */
export function EventHoverRow({
  copyText,
  isContentBearing,
  isSelecting,
  isSelected,
  onSelect,
  onToggle,
  onCopied,
  children,
}: EventHoverRowProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      onCopied?.();
      setTimeout(() => { setCopied(false); }, 2000);
    } catch {
      // Clipboard write failed silently
    }
  }, [copyText, onCopied]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isSelecting) {
        return;
      }
      // Don't intercept if the user clicked inside an interactive element
      const target = e.target as HTMLElement;
      if (target.closest("a, button, input, textarea, select, [role=button]")) {
        return;
      }
      e.preventDefault();
      onToggle(e.shiftKey);
    },
    [isSelecting, onToggle],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!isContentBearing || isSelecting) {
        return;
      }
      // Only prevent default if we would show our actions
      // For now, clicking Select from hover or context menu enters selection mode
      // A full custom context menu is a future enhancement
    },
    [isContentBearing, isSelecting],
  );

  // Non-content-bearing events: render plain, no interactivity
  if (!isContentBearing) {
    return <div className={styles.row}>{children}</div>;
  }

  // Selection mode: checkbox + clickable row
  if (isSelecting) {
    return (
      <div
        className={`${styles.row} ${styles.selectingRow} ${isSelected ? styles.selected : ""}`}
        onClick={handleRowClick}
        role="option"
        aria-selected={isSelected}
        data-testid="event-selectable-row"
      >
        <div className={styles.checkboxArea}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => { onToggle(false); }}
            onClick={(e) => { e.stopPropagation(); }}
            className={styles.checkbox}
            aria-label="Select this event"
            data-testid="event-select-checkbox"
          />
        </div>
        <div className={styles.contentArea}>{children}</div>
      </div>
    );
  }

  // Normal mode: hover action row
  return (
    <div
      className={styles.row}
      onContextMenu={handleContextMenu}
      data-testid="event-hover-row"
    >
      <div className={styles.hoverActions} data-testid="event-hover-actions">
        <button
          type="button"
          className={styles.hoverButton}
          onClick={() => { handleCopy().catch(() => {}); }}
          aria-label="Copy event content"
          data-testid="event-hover-copy"
        >
          {copied
            ? <Check size={ICON_SM} aria-hidden="true" />
            : <Clipboard size={ICON_SM} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={styles.hoverButton}
          onClick={onSelect}
          aria-label="Select this event"
          data-testid="event-hover-select"
        >
          <CheckSquare size={ICON_SM} aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  );
}
