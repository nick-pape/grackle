import { useState, type JSX } from "react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { CopyButton } from "../display/CopyButton.js";
import styles from "./toolCards.module.scss";

/** Extracts the file path from tool args (handles both `file_path` and `path` variants). */
function getFilePath(args: unknown): string {
  if (args === null || args === undefined || typeof args !== "object") {
    return "";
  }
  const a = args as Record<string, unknown>;
  if (typeof a.file_path === "string") {
    return a.file_path;
  }
  if (typeof a.path === "string") {
    return a.path;
  }
  return "";
}

/** Extracts the basename from a file path (handles both / and \ separators). */
function basename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

/** Number of preview lines shown when collapsed. */
const PREVIEW_LINES: number = 5;

/** Extra props for FileReadCard to support write variant styling. */
interface FileReadCardProps extends ToolCardProps {
  /** When true, uses green accent and write icon instead of blue/read. */
  writeVariant?: boolean;
}

/** Renders a file read/write tool call with syntax-highlighted content preview. */
export function FileReadCard({ tool, args, result, isError, writeVariant }: FileReadCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const filePath = getFilePath(args);
  const name = basename(filePath);
  const inProgress = result === undefined;

  const accentClass: string = isError ? styles.cardRed : (writeVariant ? styles.cardGreen : styles.cardBlue);
  const accentColor: string = writeVariant ? "var(--accent-green)" : "var(--accent-blue)";
  const icon: string = writeVariant ? "📝" : "📄";
  const testId: string = writeVariant ? "tool-card-file-write" : "tool-card-file-read";

  const lines = result?.split("\n") ?? [];
  const hasMore = lines.length > PREVIEW_LINES;
  const displayLines = expanded ? lines : lines.slice(0, PREVIEW_LINES);

  return (
    <div
      className={`${styles.card} ${accentClass} ${inProgress ? styles.inProgress : ""}`}
      data-testid={testId}
    >
      <div className={styles.header}>
        <span className={styles.icon}>{icon}</span>
        <span className={styles.toolName} style={{ color: accentColor }}>{tool}</span>
        {name && (
          <span className={styles.fileName} title={filePath}>{name}</span>
        )}
        {!inProgress && lines.length > 0 && (
          <>
            <span className={styles.spacer} />
            <span className={styles.badge}>{lines.length} lines</span>
          </>
        )}
        {!inProgress && !isError && result && (
          <CopyButton text={result} data-testid="tool-card-copy" className={styles.copyButtonInline} />
        )}
      </div>

      {isError && result && (
        <pre className={styles.pre} data-testid="tool-card-error">
          {result}
        </pre>
      )}

      {!isError && !inProgress && lines.length > 0 && (
        <>
          <pre className={styles.pre} data-testid="tool-card-content">
            {displayLines.map((line, i) => (
              <span key={i} className={styles.diffLine}>
                <span style={{ color: "var(--text-tertiary)", userSelect: "none", marginRight: "var(--space-sm)", display: "inline-block", width: "3ch", textAlign: "right" }}>
                  {i + 1}
                </span>
                {line}
              </span>
            ))}
          </pre>
          {hasMore && (
            <button
              type="button"
              className={styles.bodyToggle}
              onClick={() => { setExpanded((v) => !v); }}
              aria-expanded={expanded}
              data-testid="tool-card-toggle"
            >
              <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}>▸</span>
              {expanded ? "collapse" : `${lines.length - PREVIEW_LINES} more lines`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
