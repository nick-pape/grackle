import { useState, type JSX } from "react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { CopyButton } from "../display/CopyButton.js";
import styles from "./toolCards.module.scss";

/** Extracts query from ToolSearch args. */
function getQuery(args: unknown): string {
  if (args === null || args === undefined || typeof args !== "object") {
    return "";
  }
  const a = args as Record<string, unknown>;
  return typeof a.query === "string" ? a.query : "";
}

/** Number of lines shown when collapsed. */
const PREVIEW_LINES: number = 8;

/** Renders a ToolSearch call (Claude Code built-in) with query and results. */
export function ToolSearchCard({ args, result, isError }: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const query = getQuery(args);
  const inProgress = result === undefined;

  const resultLines = result?.split("\n") ?? [];
  const hasMore = resultLines.length > PREVIEW_LINES;
  const displayResult = expanded ? result : resultLines.slice(0, PREVIEW_LINES).join("\n");

  return (
    <div
      className={`${styles.card} ${isError ? styles.cardRed : styles.cardNeutral} ${inProgress ? styles.inProgress : ""}`}
      data-testid="tool-card-tool-search"
    >
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">&#x1F527;</span>
        <span className={styles.toolName}>ToolSearch</span>
        {query && (
          <span className={styles.fileName} data-testid="tool-card-tool-search-query">
            &quot;{query}&quot;
          </span>
        )}
        {!inProgress && !isError && result && (
          <>
            <span className={styles.spacer} />
            <span className={styles.badge} data-testid="tool-card-tool-search-count">
              {resultLines.length} lines
            </span>
            <CopyButton text={result} data-testid="tool-card-copy" className={styles.copyButtonInline} />
          </>
        )}
      </div>

      {/* In-progress: show query */}
      {inProgress && !query && args !== null && args !== undefined && (
        <pre className={styles.pre} data-testid="tool-card-args">
          {JSON.stringify(args, null, 2)}
        </pre>
      )}

      {/* Error */}
      {isError && result && (
        <pre className={styles.pre} data-testid="tool-card-error">
          {result}
        </pre>
      )}

      {/* Result text */}
      {!isError && !inProgress && result && (
        <>
          <pre className={styles.pre} data-testid="tool-card-tool-search-result">
            {displayResult}
          </pre>
          {hasMore && (
            <button
              type="button"
              className={styles.bodyToggle}
              onClick={() => { setExpanded((v) => !v); }}
              aria-expanded={expanded}
              data-testid="tool-card-toggle"
            >
              <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}>&#x25B8;</span>
              {expanded ? "collapse" : `${resultLines.length - PREVIEW_LINES} more lines`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
