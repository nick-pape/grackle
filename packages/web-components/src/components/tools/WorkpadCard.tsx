import { useState, type JSX } from "react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { extractBareName } from "./classifyTool.js";
import { CopyButton } from "../display/CopyButton.js";
import styles from "./toolCards.module.scss";

/** Extracts workpad-relevant fields from tool args. */
function getArgs(args: unknown): { status?: string; summary?: string } {
  if (args === null || args === undefined || typeof args !== "object") {
    return {};
  }
  const a = args as Record<string, unknown>;
  return {
    status: typeof a.status === "string" ? a.status : undefined,
    summary: typeof a.summary === "string" ? a.summary : undefined,
  };
}

/** Parses workpad result. Could be { taskId, workpad: {...} } or the workpad object itself. */
function parseResult(result: string | undefined): { status?: string; summary?: string; extra?: Record<string, unknown> } {
  if (!result) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(result);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    // workpad_write returns { taskId, workpad: { status, summary, extra } }
    const workpad = (typeof obj.workpad === "object" && obj.workpad !== null)
      ? obj.workpad as Record<string, unknown>
      : obj;
    return {
      status: typeof workpad.status === "string" ? workpad.status : undefined,
      summary: typeof workpad.summary === "string" ? workpad.summary : undefined,
      extra: typeof workpad.extra === "object" && workpad.extra !== null
        ? workpad.extra as Record<string, unknown>
        : undefined,
    };
  } catch { /* fall through */ }
  return {};
}

/** Renders a workpad tool call (workpad_write, workpad_read) with structured display. */
export function WorkpadCard({ tool, args, result, isError }: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const bareName = extractBareName(tool);
  const argData = getArgs(args);
  const inProgress = result === undefined;
  const resultData = parseResult(result);

  const displayStatus = resultData.status ?? argData.status;
  const displaySummary = resultData.summary ?? argData.summary;

  return (
    <div
      className={`${styles.card} ${isError ? styles.cardRed : styles.cardGreen} ${inProgress ? styles.inProgress : ""}`}
      data-testid="tool-card-workpad"
    >
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">&#x1F4D3;</span>
        <span className={styles.toolName} style={{ color: "var(--accent-green, #4ade80)" }}>
          {bareName}
        </span>
        {displayStatus && (
          <>
            <span className={styles.spacer} />
            <span className={styles.badge} data-testid="tool-card-workpad-status">
              {displayStatus}
            </span>
          </>
        )}
        {!inProgress && !isError && result && (
          <CopyButton text={result} data-testid="tool-card-copy" className={styles.copyButtonInline} />
        )}
      </div>

      {/* Summary */}
      {displaySummary && (
        <pre className={styles.pre} style={{ whiteSpace: "pre-wrap" }} data-testid="tool-card-workpad-summary">
          {displaySummary}
        </pre>
      )}

      {/* In-progress: show args if no summary */}
      {inProgress && !displaySummary && args !== null && args !== undefined && (
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

      {/* Extra data (expandable) */}
      {!isError && resultData.extra && (
        <>
          <button
            type="button"
            className={styles.bodyToggle}
            onClick={() => { setExpanded((v) => !v); }}
            aria-expanded={expanded}
            data-testid="tool-card-toggle"
          >
            <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}>&#x25B8;</span>
            {expanded ? "collapse" : "extra data"}
          </button>
          {expanded && (
            <pre className={styles.pre} data-testid="tool-card-workpad-extra">
              {JSON.stringify(resultData.extra, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
