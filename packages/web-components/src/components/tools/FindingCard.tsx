import { useState, type JSX } from "react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { extractBareName } from "./classifyTool.js";
import styles from "./toolCards.module.scss";

/** Shape of a single finding in MCP results. */
interface Finding {
  id?: string;
  title?: string;
  category?: string;
  content?: string;
  tags?: string[];
  createdAt?: string;
}

/** Extracts finding-relevant fields from tool args. */
function getArgs(args: unknown): { title?: string; category?: string; tags?: string[] } {
  if (args === null || args === undefined || typeof args !== "object") {
    return {};
  }
  const a = args as Record<string, unknown>;
  return {
    title: typeof a.title === "string" ? a.title : undefined,
    category: typeof a.category === "string" ? a.category : undefined,
    tags: Array.isArray(a.tags) ? (a.tags as string[]) : undefined,
  };
}

/** Parses MCP result JSON into a finding or array of findings. */
function parseResult(result: string | undefined): { single?: Finding; list?: Finding[] } {
  if (!result) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(result);
    if (Array.isArray(parsed)) {
      return { list: (parsed as unknown[]).filter((v): v is Finding => v !== null && typeof v === "object") };
    }
    if (typeof parsed === "object" && parsed !== null) {
      return { single: parsed as Finding };
    }
  } catch { /* fall through */ }
  return {};
}

/** Number of items shown when collapsed. */
const PREVIEW_COUNT: number = 5;

/** Number of content lines shown when collapsed. */
const PREVIEW_LINES: number = 5;

/** Renders a finding tool call (finding_post, finding_list) with structured display. */
export function FindingCard({ tool, args, result, isError }: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const bareName = extractBareName(tool);
  const argData = getArgs(args);
  const inProgress = result === undefined;
  const { single, list } = parseResult(result);

  // Determine title to show in header
  const displayTitle = single?.title ?? argData.title;
  // Only show category badge for single findings, not when displaying a list
  const displayCategory = list ? undefined : (single?.category ?? argData.category);
  const displayTags = list ? undefined : (single?.tags ?? argData.tags);

  return (
    <div
      className={`${styles.card} ${isError ? styles.cardRed : styles.cardPurple} ${inProgress ? styles.inProgress : ""}`}
      data-testid="tool-card-finding"
    >
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">&#x1F4A1;</span>
        <span className={styles.toolName} style={{ color: "var(--accent-purple, #a78bfa)" }}>
          {bareName}
        </span>
        {displayTitle && (
          <span className={styles.fileName} data-testid="tool-card-finding-title">
            &quot;{displayTitle}&quot;
          </span>
        )}
        {displayCategory && (
          <>
            <span className={styles.spacer} />
            <span className={styles.badge} data-testid="tool-card-finding-category">
              {displayCategory}
            </span>
          </>
        )}
        {list && !displayCategory && (
          <>
            <span className={styles.spacer} />
            <span className={styles.badge} data-testid="tool-card-finding-count">
              {list.length} {list.length === 1 ? "finding" : "findings"}
            </span>
          </>
        )}
      </div>

      {/* Tags */}
      {displayTags && displayTags.length > 0 && (
        <div className={styles.pre} style={{ padding: "4px 8px", whiteSpace: "normal" }} data-testid="tool-card-finding-tags">
          {displayTags.map((tag, i) => (
            <span key={i} style={{ display: "inline-block", marginRight: "6px", opacity: 0.7, fontSize: "0.85em" }}>
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* In-progress: show args summary */}
      {inProgress && !displayTitle && args !== null && args !== undefined && (
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

      {/* Single finding result: show content */}
      {!isError && single?.content && (
        <>
          {(() => {
            const lines = single.content.split("\n");
            const hasMore = lines.length > PREVIEW_LINES;
            const displayContent = expanded ? single.content : lines.slice(0, PREVIEW_LINES).join("\n");
            return (
              <>
                <pre className={styles.pre} data-testid="tool-card-finding-content">
                  {displayContent}
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
                    {expanded ? "collapse" : `${lines.length - PREVIEW_LINES} more lines`}
                  </button>
                )}
              </>
            );
          })()}
        </>
      )}

      {/* List result: show compact finding titles */}
      {!isError && list && list.length > 0 && (
        <>
          <pre className={styles.pre} data-testid="tool-card-finding-list">
            {(expanded ? list : list.slice(0, PREVIEW_COUNT)).map((f, i) => (
              `${f.category ? `[${f.category}] ` : ""}${f.title ?? f.id ?? `Finding ${i + 1}`}`
            )).join("\n")}
          </pre>
          {list.length > PREVIEW_COUNT && (
            <button
              type="button"
              className={styles.bodyToggle}
              onClick={() => { setExpanded((v) => !v); }}
              aria-expanded={expanded}
              data-testid="tool-card-toggle"
            >
              <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}>&#x25B8;</span>
              {expanded ? "collapse" : `${list.length - PREVIEW_COUNT} more findings`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
