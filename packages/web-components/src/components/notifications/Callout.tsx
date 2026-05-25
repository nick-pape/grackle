import { useState, type ReactNode, type JSX } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { type CalloutBuiltinProps, type CalloutVariant } from "@grackle-ai/common";
import styles from "./Callout.module.scss";
import { ICON_LG, ICON_MD } from "../../utils/iconSize.js";

// `variant` now lives in the built-in's zod schema (@grackle-ai/common);
// re-export the union so the package barrel keeps exposing CalloutVariant.
export type { CalloutVariant };

interface CalloutProps extends CalloutBuiltinProps {
  children: ReactNode;
  /** Optional extra class name for layout overrides. */
  className?: string;
}

const VARIANT_ICONS: Record<CalloutVariant, ReactNode> = {
  success: <Check size={ICON_LG} />,
  error: <X size={ICON_LG} />,
  warning: <AlertTriangle size={ICON_LG} />,
  info: <Info size={ICON_LG} />,
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
              <X size={ICON_MD} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </>
  );
}
