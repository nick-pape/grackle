import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import styles from "./CopyButton.module.scss";

/** Duration in milliseconds to show the "copied" checkmark before reverting. */
const COPIED_FEEDBACK_DURATION: number = 2000;

/** Props for the CopyButton component. */
interface CopyButtonProps {
  /** Plain text to copy to the clipboard. */
  text: string;
  /** Additional CSS class name for positioning variants. */
  className?: string;
  /** Test ID for Storybook and E2E tests. */
  "data-testid"?: string;
}

/**
 * Small copy-to-clipboard button with visual feedback.
 *
 * Shows a clipboard emoji by default, switches to a checkmark on click,
 * then reverts after 2 seconds.
 */
export function CopyButton({ text, className, "data-testid": testId }: CopyButtonProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleClick = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = undefined;
      }, COPIED_FEEDBACK_DURATION);
    } catch {
      /* clipboard API unavailable — fail silently */
    }
  }, [text]);

  return (
    <button
      type="button"
      className={`${styles.copyButton} ${className ?? ""}`}
      onClick={() => { handleClick().catch(() => { /* clipboard unavailable */ }); }}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      data-testid={testId ?? "copy-button"}
    >
      {copied ? "\u2713" : "\uD83D\uDCCB"}
    </button>
  );
}
