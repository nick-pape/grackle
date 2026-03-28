import { useState, type JSX } from "react";
import { ChevronRight, Cog } from "lucide-react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { CopyButton } from "../display/CopyButton.js";
import { ICON_SM, ICON_MD } from "../../utils/iconSize.js";
import styles from "./toolCards.module.scss";

/** Formats an MCP tool name for display: `mcp__server__tool` → `server / tool`. */
function formatToolName(tool: string): { display: string; isMcp: boolean } {
  const mcpMatch = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcpMatch) {
    return { display: `${mcpMatch[1]} / ${mcpMatch[2]}`, isMcp: true };
  }
  return { display: tool, isMcp: false };
}

/** Extracts a one-line human-readable summary of tool arguments. */
function argsPreview(args: unknown): string {
  if (args === null || args === undefined) {
    return "";
  }
  if (typeof args !== "object") {
    return String(args);
  }
  const a = args as Record<string, unknown>;
  // Common patterns
  if (typeof a.command === "string") { return a.command; }
  if (typeof a.file_path === "string") { return a.file_path; }
  if (typeof a.path === "string") { return a.path; }
  if (typeof a.query === "string") { return a.query; }
  if (typeof a.url === "string") { return a.url; }
  // Fallback
  try {
    const json = JSON.stringify(args);
    return json.length > 120 ? `${json.slice(0, 120)}\u2026` : json;
  } catch {
    return "";
  }
}

/** Number of result lines shown when collapsed. */
const PREVIEW_LINES: number = 5;

/** Renders a generic/unknown tool call with formatted args and result. */
export function GenericToolCard({ tool, args, result, isError }: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const { display } = formatToolName(tool);
  const preview = argsPreview(args);
  const inProgress = result === undefined;

  const resultLines = result?.split("\n") ?? [];
  const hasMore = resultLines.length > PREVIEW_LINES;
  const displayResult = expanded ? result : resultLines.slice(0, PREVIEW_LINES).join("\n");

  // Format args as pretty JSON for expanded view
  let argsFormatted = "";
  if (args !== null && args !== undefined) {
    try {
      argsFormatted = JSON.stringify(args, null, 2);
    } catch {
      argsFormatted = String(args);
    }
  }

  return (
    <div
      className={`${styles.card} ${isError ? styles.cardRed : styles.cardBlue} ${inProgress ? styles.inProgress : ""}`}
      data-testid="tool-card-generic"
    >
      <div className={styles.header}>
        <span className={styles.icon}><Cog size={ICON_MD} /></span>
        <span className={styles.toolName} style={{ color: "var(--accent-blue)" }}>{display}</span>
        {preview && (
          <span className={styles.fileName}>{preview}</span>
        )}
        {!inProgress && !isError && result && (
          <CopyButton text={result} data-testid="tool-card-copy" className={styles.copyButtonInline} />
        )}
      </div>

      {/* Show formatted args when no result yet */}
      {inProgress && argsFormatted && (
        <pre className={styles.pre} data-testid="tool-card-args">
          {argsFormatted}
        </pre>
      )}

      {isError && result && (
        <pre className={styles.pre} data-testid="tool-card-error">
          {result}
        </pre>
      )}

      {!isError && !inProgress && result && (
        <>
          <pre className={styles.pre} data-testid="tool-card-result">
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
              <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}><ChevronRight size={ICON_SM} /></span>
              {expanded ? "collapse" : `${resultLines.length - PREVIEW_LINES} more lines`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
