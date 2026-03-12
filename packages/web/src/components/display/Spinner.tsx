import type { JSX } from "react";
import styles from "./Spinner.module.scss";

/** Size variants for the Spinner component. */
type SpinnerSize = "sm" | "md" | "lg";

/** Props for the Spinner component. */
interface Props {
  /** Size of the spinner. Defaults to "md". */
  size?: SpinnerSize;
  /** Additional CSS class name. */
  className?: string;
  /** Accessible label for screen readers. Defaults to "Loading". */
  label?: string;
}

/**
 * Inline spinning loader that inherits the current text color.
 * Use alongside disabled buttons or hint text to signal in-flight async operations.
 */
export function Spinner({ size = "md", className, label = "Loading" }: Props): JSX.Element {
  return (
    <span
      className={`${styles.spinner} ${styles[size]} ${className ?? ""}`}
      role="status"
      aria-label={label}
    />
  );
}
