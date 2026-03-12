import { useId, type JSX } from "react";
import { AnimatePresence, motion } from "motion/react";
import styles from "./ConfirmDialog.module.scss";

/** Props for the ConfirmDialog component. */
interface ConfirmDialogProps {
  /** Whether the dialog is currently visible. */
  isOpen: boolean;
  /** Short, action-oriented title (e.g. "Delete Task?"). */
  title: string;
  /** Consequence description shown below the title. */
  description?: string;
  /** Label for the danger confirm button. Defaults to "Delete". */
  confirmLabel?: string;
  /** Called when the user confirms the destructive action. */
  onConfirm: () => void;
  /** Called when the user cancels or clicks the overlay backdrop. */
  onCancel: () => void;
}

/**
 * Modal confirmation dialog with glass card aesthetic and motion animation.
 *
 * Replaces native `window.confirm()` for destructive actions, providing a
 * styled in-app dialog that matches the dark glass UI.
 */
export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onCancel}
          onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
        >
          <motion.div
            className={styles.dialog}
            initial={{ opacity: 0, scale: 0.93, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.93, y: -10 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id={titleId} className={styles.title}>{title}</h3>
            {description && (
              <p id={descriptionId} className={styles.description}>{description}</p>
            )}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={onCancel}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.confirmButton}
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
