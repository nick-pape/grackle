import type { JSX } from "react";
import { FileQuestion, FileX } from "lucide-react";
import styles from "./DocPane.module.scss";

/** Props for {@link FallbackPreview}. */
export interface FallbackPreviewProps {
  /** The file URI being previewed. */
  uri: string;
  /** When true, the file was deleted (vs. an unsupported type). */
  deleted?: boolean;
}

/**
 * Placeholder shown when a tab's file can't be rendered inline (#1396): a binary
 * or otherwise unsupported type (rich/binary previews are deferred to #1428), or
 * a file that no longer exists. Keeps the tab open without breaking the pane.
 */
export function FallbackPreview({ uri, deleted }: FallbackPreviewProps): JSX.Element {
  return (
    <div className={styles.fallback} data-testid="doc-fallback">
      {deleted ? <FileX aria-hidden /> : <FileQuestion aria-hidden />}
      <p className={styles.fallbackMessage}>
        {deleted
          ? "This file no longer exists."
          : "No inline preview is available for this file type."}
      </p>
      <code className={styles.fallbackPath}>{uri}</code>
    </div>
  );
}
