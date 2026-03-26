import { useState, type JSX } from "react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { parseUnifiedDiff, diffFromOldNew, diffStats, type DiffLine } from "./parseDiff.js";
import styles from "./toolCards.module.scss";

/** Extracts file path from edit tool args (handles `file_path`, `path` variants). */
function getFilePath(args: unknown): string {
  if (args === null || args === undefined || typeof args !== "object") {
    return "";
  }
  const a = args as Record<string, unknown>;
  return (typeof a.file_path === "string" && a.file_path)
    || (typeof a.path === "string" && a.path)
    || "";
}

/** Extracts old/new string pair from args (handles Claude Code and Copilot field names). */
function getOldNew(args: unknown): { oldStr: string; newStr: string } | undefined {
  if (args === undefined || typeof args !== "object" || args === null) {
    return undefined;
  }
  const a = args as Record<string, unknown>;
  const oldStr: string | undefined = (typeof a.old_string === "string" ? a.old_string : undefined)
    ?? (typeof a.old_str === "string" ? a.old_str : undefined);
  const newStr: string | undefined = (typeof a.new_string === "string" ? a.new_string : undefined)
    ?? (typeof a.new_str === "string" ? a.new_str : undefined);
  if (oldStr !== undefined && newStr !== undefined) {
    return { oldStr, newStr };
  }
  return undefined;
}

/** Extracts the basename from a file path. */
function basename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

/**
 * Resolves diff lines from available data sources.
 *
 * Priority: detailedResult (unified diff) > args old/new strings > null.
 */
function resolveDiff(args: unknown, detailedResult?: string): DiffLine[] | undefined {
  // 1. Try detailedResult as unified diff
  if (detailedResult) {
    // Copilot embeds diff in a JSON object sometimes
    let diffText = detailedResult;
    // Only attempt JSON parse if it looks like a JSON object (avoids throwing
    // on unified diff strings which are the common case)
    if (detailedResult.trimStart().startsWith("{")) {
      try {
        const parsed = JSON.parse(detailedResult) as Record<string, unknown>;
        if (typeof parsed.detailedContent === "string") {
          diffText = parsed.detailedContent;
        }
      } catch { /* not valid JSON despite looking like one — use as-is */ }
    }

    if (diffText.includes("@@") || diffText.startsWith("diff ")) {
      const lines = parseUnifiedDiff(diffText);
      if (lines.length > 0) {
        return lines;
      }
    }
  }

  // 2. Try old/new string pair from args
  const oldNew = getOldNew(args);
  if (oldNew) {
    return diffFromOldNew(oldNew.oldStr, oldNew.newStr);
  }

  return undefined;
}

/** Number of diff lines shown when collapsed. */
const PREVIEW_LINES: number = 5;

/** Renders a file edit tool call with a unified diff view. */
export function FileEditCard({ tool, args, result, isError, detailedResult }: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const filePath = getFilePath(args);
  const name = basename(filePath);
  const inProgress = result === undefined;

  const diffLines = resolveDiff(args, detailedResult);
  const stats = diffLines ? diffStats(diffLines) : null;
  const hasMore = (diffLines?.length ?? 0) > PREVIEW_LINES;
  const displayLines = expanded ? diffLines : diffLines?.slice(0, PREVIEW_LINES);

  return (
    <div
      className={`${styles.card} ${isError ? styles.cardRed : styles.cardOrange} ${inProgress ? styles.inProgress : ""}`}
      data-testid="tool-card-file-edit"
    >
      <div className={styles.header}>
        <span className={styles.icon}>✏️</span>
        <span className={styles.toolName} style={{ color: "var(--accent-yellow)" }}>{tool}</span>
        {name && (
          <span className={styles.fileName} title={filePath}>{name}</span>
        )}
        {stats && (
          <>
            <span className={styles.spacer} />
            <span className={styles.badge} data-testid="tool-card-diff-stats">
              <span style={{ color: "var(--accent-green)" }}>+{stats.added}</span>
              {" "}
              <span style={{ color: "var(--accent-red)" }}>−{stats.removed}</span>
            </span>
          </>
        )}
      </div>

      {isError && result && (
        <pre className={styles.pre} data-testid="tool-card-error">
          {result}
        </pre>
      )}

      {!isError && displayLines && displayLines.length > 0 && (
        <>
          <pre className={styles.pre} data-testid="tool-card-diff">
            {displayLines.map((line, i) => {
              let lineClass = styles.diffContext;
              if (line.type === "add") { lineClass = styles.diffAdd; }
              if (line.type === "remove") { lineClass = styles.diffRemove; }
              if (line.type === "header") { lineClass = styles.diffHeader; }
              return (
                <span key={i} className={`${styles.diffLine} ${lineClass}`}>
                  {line.content}
                </span>
              );
            })}
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
              {expanded ? "collapse" : `${(diffLines?.length ?? 0) - PREVIEW_LINES} more lines`}
            </button>
          )}
        </>
      )}

      {!isError && !diffLines && !inProgress && result && (
        <pre className={styles.pre} data-testid="tool-card-content">
          {result}
        </pre>
      )}
    </div>
  );
}
