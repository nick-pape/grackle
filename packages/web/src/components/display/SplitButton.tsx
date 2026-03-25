import { useState, useRef, useEffect, type JSX } from "react";
import type { ButtonVariant, ButtonSize } from "./Button.js";
import styles from "./SplitButton.module.scss";

/** A single option in the split button dropdown. */
export interface SplitButtonOption {
  /** Display label. */
  label: string;
  /** Short description shown below the label. */
  description?: string;
  /** Callback fired when this option is selected. */
  onClick: () => void;
}

/** Props for the {@link SplitButton} component. */
export interface SplitButtonProps {
  /** Label for the main (default) action. */
  label: string;
  /** Callback for the main action (clicking the label area). */
  onClick: () => void;
  /** Menu options shown when the chevron is clicked. */
  options: SplitButtonOption[];
  /** Visual variant. Defaults to `"primary"`. */
  variant?: ButtonVariant;
  /** Size. Defaults to `"md"`. */
  size?: ButtonSize;
  /** data-testid for the root element. */
  "data-testid"?: string;
}

/**
 * Compound split button with a main action and a chevron dropdown for
 * additional options. The main area fires the default action; the chevron
 * opens a dropdown menu with all available options.
 */
export function SplitButton({
  label,
  onClick,
  options,
  variant = "primary",
  size = "md",
  "data-testid": testId,
}: SplitButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) {
      return;
    }
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) {
      return;
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const variantClass = styles[variant] || "";
  const sizeClass = styles[size] || "";

  return (
    <div ref={containerRef} className={styles.container} data-testid={testId}>
      <button
        type="button"
        className={`${styles.mainButton} ${variantClass} ${sizeClass}`}
        onClick={onClick}
        data-testid={testId ? `${testId}-main` : undefined}
      >
        {label}
      </button>
      <button
        type="button"
        className={`${styles.chevronButton} ${variantClass} ${sizeClass}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-label="More options"
        aria-expanded={open}
        data-testid={testId ? `${testId}-chevron` : undefined}
      >
        ▾
      </button>
      {open && (
        <div className={styles.dropdown} data-testid={testId ? `${testId}-menu` : undefined}>
          {options.map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={styles.option}
              onClick={() => {
                opt.onClick();
                setOpen(false);
              }}
            >
              <span className={styles.optionLabel}>{opt.label}</span>
              {opt.description && <span className={styles.optionDesc}>{opt.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
