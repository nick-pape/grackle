import { forwardRef, type ButtonHTMLAttributes, type JSX } from "react";
import type React from "react";
import styles from "./Button.module.scss";

/** Visual variant of the button. */
export type ButtonVariant = "primary" | "danger" | "outline" | "ghost";

/** Size of the button. */
export type ButtonSize = "sm" | "md" | "lg";

/** Props for the {@link Button} component. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant. Defaults to `"primary"`. */
  variant?: ButtonVariant;
  /** Size. Defaults to `"md"`. */
  size?: ButtonSize;
}

/**
 * Standardized button with consistent sizing and styling across the app.
 *
 * Uses the existing mixin-based design tokens so colours/radii stay in sync
 * with the rest of the UI.
 */
export const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>> = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "primary", size = "md", className, children, ...rest }: ButtonProps, ref: React.ForwardedRef<HTMLButtonElement>): JSX.Element {
    const cls = [
      styles.btn,
      styles[variant],
      styles[size],
      className,
    ].filter(Boolean).join(" ");

    return (
      <button ref={ref} className={cls} {...rest}>
        {children}
      </button>
    );
  },
);
