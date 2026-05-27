import { forwardRef, type ButtonHTMLAttributes, type JSX } from "react";
import type React from "react";
import { type ButtonBuiltinProps, type ButtonVariant, type ButtonSize } from "@grackle-ai/common";
import styles from "./Button.module.scss";

// The variant/size unions now live in the built-in's zod schema
// (@grackle-ai/common); re-export them so existing imports from "./Button.js"
// (SplitButton, the package barrel) keep resolving.
export type { ButtonVariant, ButtonSize };

/**
 * Props for the {@link Button} component. The agent-facing data props (variant,
 * size) are inferred from the built-in's zod schema so the GenUX catalog can't
 * drift from the component; `disabled` and the rest come from the native button
 * attributes.
 */
export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<ButtonBuiltinProps, "disabled"> {}

/**
 * Standardized button with consistent sizing and styling across the app.
 *
 * Uses the existing mixin-based design tokens so colours/radii stay in sync
 * with the rest of the UI.
 */
export const Button: React.ForwardRefExoticComponent<
  ButtonProps & React.RefAttributes<HTMLButtonElement>
> = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, children, ...rest }: ButtonProps,
  ref: React.ForwardedRef<HTMLButtonElement>,
): JSX.Element {
  const cls = [styles.btn, styles[variant], styles[size], className].filter(Boolean).join(" ");

  return (
    <button ref={ref} className={cls} {...rest}>
      {children}
    </button>
  );
});
