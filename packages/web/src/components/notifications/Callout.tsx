import { useState, type ReactNode, type JSX } from "react";
import styles from "./Callout.module.scss";

/** Visual style variant for a callout. */
export type CalloutVariant = "success" | "error" | "warning" | "info";

interface CalloutProps {
  /** Controls color scheme and icon. Defaults to "info". */
  variant?: CalloutVariant;
  children: ReactNode;
  /** Show a dismiss button. Defaults to false. */
  dismissible?: boolean;
  /** Optional extra class name for layout overrides. */
  className?: string;
}

const VARIANT_ICONS: Record<CalloutVariant, string> = {
  success: "\u2713", // ✓
  error: "\u2715",   // ✕
  warning: "\u26A0", // ⚠
  info: "\u2139",    // ℹ
};

/**
 * Inline contextual alert for persistent, location-specific information.
 * Use for things like blocked dependencies, validation errors, or
 * status messages that belong within a specific panel rather than a toast.
 */
export function Callout({
  variant = "info",
  children,
  dismissible = false,
  className,
}: CalloutProps): JSX.Element {
  const [dismissed, setDismissed] = useState(false);

  return (
    <>
      {!dismissed && (
        <div
          className={[styles.callout, styles[variant], className].filter(Boolean).join(" ")}
          role={variant === "error" || variant === "warning" ? "alert" : "status"}
        >
          <span className={styles.icon} aria-hidden="true">
            {VARIANT_ICONS[variant]}
          </span>
          <span className={styles.content}>{children}</span>
          {dismissible && (
            <button
              type="button"
              className={styles.close}
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
            >
              {"\u00D7"}
            </button>
          )}
        </div>
      )}
    </>
  );
}
