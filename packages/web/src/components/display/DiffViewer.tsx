import type { JSX } from "react";
import type { TaskDiffData } from "../../hooks/useGrackleSocket.js";
import styles from "./DiffViewer.module.scss";

/** Props for the DiffViewer component. */
interface Props {
  diff: TaskDiffData | undefined;
}

/** Classifies a diff line for styling purposes. */
function getDiffLineClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return styles.added;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return styles.removed;
  }
  if (line.startsWith("@@")) {
    return styles.hunk;
  }
  if (line.startsWith("diff ") || line.startsWith("index ")) {
    return styles.meta;
  }
  return styles.context;
}

/** Displays a unified diff with stats bar, file list, and colored line-by-line output. */
export function DiffViewer({ diff }: Props): JSX.Element {
  if (!diff) {
    return (
      <div className={styles.emptyState}>
        Loading diff...
      </div>
    );
  }

  if (diff.error) {
    return (
      <div className={styles.errorState}>
        {diff.error}
      </div>
    );
  }

  if (!diff.diff || diff.diff.trim() === "") {
    return (
      <div className={styles.emptyState}>
        No changes on branch {diff.branch}
      </div>
    );
  }

  const lines = diff.diff.split("\n");

  return (
    <div className={styles.container}>
      {/* Stats bar */}
      <div className={styles.statsBar}>
        <span>Branch: <b className={styles.branchName}>{diff.branch}</b></span>
        <span>Files: <b>{diff.changedFiles?.length || 0}</b></span>
        <span className={styles.additions}>+{diff.additions || 0}</span>
        <span className={styles.deletions}>-{diff.deletions || 0}</span>
      </div>

      {/* File list */}
      {diff.changedFiles && diff.changedFiles.length > 0 && (
        <div className={styles.fileList}>
          {diff.changedFiles.map((f) => (
            <span key={f} className={styles.fileName}>{f}</span>
          ))}
        </div>
      )}

      {/* Diff content */}
      <div className={styles.diffContent}>
        {lines.map((line, i) => (
          <div
            key={i}
            className={`${styles.diffLine} ${getDiffLineClass(line)}`}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
