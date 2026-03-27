import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import styles from "./CopyButton.module.scss";

/** Duration in milliseconds to show the "copied" checkmark before reverting. */
const COPIED_FEEDBACK_DURATION: number = 2000;

/** Props for the CopyButton component. */
interface CopyButtonProps {
  /** Plain text to copy (used as text/plain MIME type). */
  text: string;
  /** Optional callback that returns HTML at click time (lazy evaluation avoids stale ref issues). */
  getHtml?: () => string | undefined;
  /** Additional CSS class name for positioning variants. */
  className?: string;
  /** Test ID for Storybook and E2E tests. */
  "data-testid"?: string;
}

/**
 * Writes both rich (HTML) and plain text to the clipboard.
 *
 * When pasting into a rich editor (Slack, Google Docs), the HTML version is used.
 * When pasting into a plain text editor (VS Code, terminal), the plain text is used.
 */
async function richCopy(text: string, html: string): Promise<void> {
  const item = new ClipboardItem({
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([text], { type: "text/plain" }),
  });
  await navigator.clipboard.write([item]);
}

/**
 * Small copy-to-clipboard button with visual feedback.
 *
 * Shows a clipboard emoji by default, switches to a checkmark on click,
 * then reverts after 2 seconds. Supports both plain text and rich (HTML + text)
 * clipboard writes.
 */
export function CopyButton({ text, getHtml, className, "data-testid": testId }: CopyButtonProps): JSX.Element {
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
      const html = getHtml?.();
      if (html) {
        await richCopy(text, html);
      } else {
        await navigator.clipboard.writeText(text);
      }
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
  }, [text, getHtml]);

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
