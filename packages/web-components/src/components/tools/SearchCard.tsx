import { useState, type JSX } from "react";
import { ChevronRight, Search } from "lucide-react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { CopyButton } from "../display/CopyButton.js";
import { ICON_SM, ICON_MD } from "../../utils/iconSize.js";
import styles from "./toolCards.module.scss";

/** Extracts search-relevant fields from tool args. */
function getSearchInfo(args: unknown): { pattern: string; path: string } {
  if (args === null || args === undefined || typeof args !== "object") {
    return { pattern: "", path: "" };
  }
  const a = args as Record<string, unknown>;
  const pattern = typeof a.pattern === "string" ? a.pattern : "";
  const path = typeof a.path === "string" ? a.path : "";
  return { pattern, path };
}

/** Number of result lines shown when collapsed. */
const PREVIEW_LINES: number = 5;

/** Renders a search tool call (Grep, Glob) with pattern and match results. */
export function SearchCard({ tool, args, result, isError }: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const { pattern, path } = getSearchInfo(args);
  const inProgress = result === undefined;

  const lines = result?.split("\n").filter((l) => l.length > 0) ?? [];
  const hasMore = lines.length > PREVIEW_LINES;
  const displayLines = expanded ? lines : lines.slice(0, PREVIEW_LINES);

  return (
    <div
      className={`${styles.card} ${isError ? styles.cardRed : styles.cardPurple} ${inProgress ? styles.inProgress : ""}`}
      data-testid="tool-card-search"
    >
      <div className={styles.header}>
        <span className={styles.icon}><Search size={ICON_MD} /></span>
        <span className={styles.toolName} style={{ color: "var(--accent-purple, #a78bfa)" }}>{tool}</span>
        {pattern && (
          <span className={styles.fileName} data-testid="tool-card-pattern">
            &quot;{pattern}&quot;
          </span>
        )}
        {path && (
          <span className={styles.fileName} style={{ flexShrink: 1 }} data-testid="tool-card-search-path">
            in {path}
          </span>
        )}
        {!inProgress && !isError && lines.length > 0 && (
          <>
            <span className={styles.spacer} />
            <span className={styles.badge} data-testid="tool-card-match-count">
              {lines.length} {lines.length === 1 ? "match" : "matches"}
            </span>
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

      {!isError && !inProgress && displayLines.length > 0 && (
        <>
          <pre className={styles.pre} data-testid="tool-card-results">
            {displayLines.join("\n")}
          </pre>
          {hasMore && (
            <button
              type="button"
              className={styles.bodyToggle}
              onClick={() => { setExpanded((v) => !v); }}
              aria-expanded={expanded}
              data-testid="tool-card-toggle"
            >
              <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`} aria-hidden="true"><ChevronRight size={ICON_SM} /></span>
              {expanded ? "collapse" : `${lines.length - PREVIEW_LINES} more matches`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
