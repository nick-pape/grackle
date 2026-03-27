import { AnimatePresence } from "motion/react";
import type { JSX } from "react";
import type { ToastItem } from "../../context/ToastContext.js";
import { Toast } from "./Toast.js";
import styles from "./ToastContainer.module.scss";

/** Props for the ToastContainer component. */
export interface ToastContainerProps {
  /** Active toast notifications to render. */
  toasts: ToastItem[];
  /** Callback to dismiss a toast by id. */
  onDismiss: (id: string) => void;
}

/**
 * Fixed overlay that renders all active toasts at the top-center of the viewport.
 * Mount this once alongside your main app layout and pass toasts from context.
 */
export function ToastContainer({ toasts, onDismiss }: ToastContainerProps): JSX.Element {
  return (
    <div className={styles.container} data-testid="toast-container">
      <AnimatePresence>
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}
