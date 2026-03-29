/**
 * Floating action bar shown at the bottom of EventStream during multi-select mode.
 *
 * Displays selection count, select all/deselect all toggle, Copy button, and Cancel.
 * Pure presentational component -- no useGrackle().
 */

import { type JSX } from "react";
import { Copy, X } from "lucide-react";
import { motion } from "motion/react";
import { ICON_SM } from "../../utils/iconSize.js";
import styles from "./FloatingActionBar.module.scss";

/** Props for the FloatingActionBar component. */
export interface FloatingActionBarProps {
  /** Number of currently selected events. */
  selectedCount: number;
  /** Total number of selectable (content-bearing) events. */
  totalSelectable: number;
  /** Called when "Select all" is clicked. */
  onSelectAll: () => void;
  /** Called when "Deselect all" is clicked. */
  onDeselectAll: () => void;
  /** Called when "Copy" is clicked. */
  onCopy: () => void;
  /** Called when "Cancel" (X) is clicked. */
  onCancel: () => void;
}

/**
 * Floating action bar for multi-select mode in EventStream.
 *
 * Positioned absolutely at the bottom of the EventStream wrapper.
 * Uses motion.div for animated entrance/exit.
 */
export function FloatingActionBar({
  selectedCount,
  totalSelectable,
  onSelectAll,
  onDeselectAll,
  onCopy,
  onCancel,
}: FloatingActionBarProps): JSX.Element {
  const allSelected = selectedCount > 0 && selectedCount >= totalSelectable;

  return (
    <motion.div
      className={styles.bar}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.15 }}
      data-testid="floating-action-bar"
    >
      <div className={styles.left}>
        <span className={styles.count} data-testid="floating-bar-count">
          {selectedCount} selected
        </span>
        <button
          type="button"
          className={styles.toggleButton}
          onClick={allSelected ? onDeselectAll : onSelectAll}
          data-testid="floating-bar-select-all"
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div className={styles.right}>
        <button
          type="button"
          className={styles.copyButton}
          onClick={onCopy}
          disabled={selectedCount === 0}
          data-testid="floating-bar-copy"
        >
          <Copy size={ICON_SM} aria-hidden="true" />
          Copy
        </button>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={onCancel}
          aria-label="Cancel selection"
          data-testid="floating-bar-cancel"
        >
          <X size={ICON_SM} aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  );
}
