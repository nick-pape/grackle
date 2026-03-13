import { AnimatePresence } from "motion/react";
import type { JSX } from "react";
import { useToast } from "../../context/ToastContext.js";
import { Toast } from "./Toast.js";
import styles from "./ToastContainer.module.scss";

/**
 * Fixed overlay that renders all active toasts at the top-center of the viewport.
 * Mount this once inside the ToastProvider, alongside your main app layout.
 */
export function ToastContainer(): JSX.Element {
  const { toasts, dismissToast } = useToast();

  return (
    <div className={styles.container}>
      <AnimatePresence>
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </AnimatePresence>
    </div>
  );
}
