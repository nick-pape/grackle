import type { JSX } from "react";
import { type SpinnerBuiltinProps } from "@grackle-ai/common";
import styles from "./Spinner.module.scss";

/** Props for the Spinner component (data props inferred from the built-in's zod schema). */
interface Props extends SpinnerBuiltinProps {
  /** Additional CSS class name. */
  className?: string;
}

/**
 * Inline spinning loader that inherits the current text color.
 * Use alongside disabled buttons or hint text to signal in-flight async operations.
 */
export function Spinner({
  size = "md",
  className,
  label = "Loading",
  liveRegion = false,
}: Props): JSX.Element {
  return (
    <span
      className={`${styles.spinner} ${styles[size]} ${className ?? ""}`}
      role={liveRegion ? "status" : undefined}
      aria-label={label}
      aria-hidden={liveRegion ? undefined : true}
    />
  );
}
