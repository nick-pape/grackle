import { useEffect, type JSX } from "react";
import { motion } from "motion/react";
import type { ToastItem } from "../../context/ToastContext.js";
import styles from "./Toast.module.scss";

const VARIANT_ICONS: Record<ToastItem["variant"], string> = {
  success: "\u2713", // ✓
  error: "\u2715",   // ✕
  warning: "\u26A0", // ⚠
  info: "\u2139",    // ℹ
};

interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

/** Animated individual toast notification. Auto-dismisses after toast.duration ms. */
export function Toast({ toast, onDismiss }: ToastProps): JSX.Element {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <motion.div
      className={`${styles.toast} ${styles[toast.variant]}`}
      role="status"
      initial={{ opacity: 0, y: -16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.94 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      layout
    >
      <span className={styles.icon} aria-hidden="true">
        {VARIANT_ICONS[toast.variant]}
      </span>
      <span className={styles.message}>{toast.message}</span>
      <button
        type="button"
        className={styles.close}
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        {"\u00D7"}
      </button>
    </motion.div>
  );
}
