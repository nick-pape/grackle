import { useState, type JSX } from "react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { extractBareName } from "./classifyTool.js";
import { CopyButton } from "../display/CopyButton.js";
import styles from "./toolCards.module.scss";

/** Shape of a task in MCP results. */
interface TaskSummary {
  id?: string;
  title?: string;
  status?: string;
  branch?: string;
  latestSessionId?: string;
  parentTaskId?: string;
  childTaskIds?: string[];
}

/** Extracts task-relevant fields from tool args. */
function getArgs(args: unknown): { taskId?: string; title?: string; status?: string } {
  if (args === null || args === undefined || typeof args !== "object") {
    return {};
  }
  const a = args as Record<string, unknown>;
  return {
    taskId: typeof a.taskId === "string" ? a.taskId : undefined,
    title: typeof a.title === "string" ? a.title : undefined,
    status: typeof a.status === "string" ? a.status : undefined,
  };
}

/** Parses MCP result JSON into a task or array of tasks. */
function parseResult(result: string | undefined): { single?: TaskSummary; list?: TaskSummary[]; sessionId?: string } {
  if (!result) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(result);
    if (Array.isArray(parsed)) {
      return { list: parsed as TaskSummary[] };
    }
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      // task_start returns { sessionId, taskId }
      if (typeof obj.sessionId === "string") {
        return { sessionId: obj.sessionId, single: obj as TaskSummary };
      }
      return { single: obj as TaskSummary };
    }
  } catch { /* fall through */ }
  return {};
}

/** Status icon for a task. */
function statusIcon(status: string | undefined): string {
  switch (status) {
    case "complete":
    case "completed":
      return "\u2713";
    case "working":
    case "in_progress":
      return "\u25CF";
    case "paused":
      return "\u23F8";
    case "failed":
      return "\u2717";
    default:
      return "\u25CB";
  }
}

/** CSS color for a task status. */
function statusColor(status: string | undefined): string {
  switch (status) {
    case "complete":
    case "completed":
      return "var(--accent-green, #4ade80)";
    case "working":
    case "in_progress":
      return "var(--accent-blue, #60a5fa)";
    case "failed":
      return "var(--accent-red, #f87171)";
    case "paused":
      return "var(--text-tertiary, #888)";
    default:
      return "var(--text-secondary, #aaa)";
  }
}

/** Number of tasks shown when collapsed. */
const PREVIEW_COUNT: number = 5;

/** Renders a task tool call with structured display. */
export function TaskCard({ tool, args, result, isError }: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const bareName = extractBareName(tool);
  const argData = getArgs(args);
  const inProgress = result === undefined;
  const { single, list, sessionId } = parseResult(result);

  const displayTitle = single?.title ?? argData.title;
  const displayStatus = single?.status ?? argData.status;

  return (
    <div
      className={`${styles.card} ${isError ? styles.cardRed : styles.cardBlue} ${inProgress ? styles.inProgress : ""}`}
      data-testid="tool-card-task"
    >
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">&#x1F4CB;</span>
        <span className={styles.toolName} style={{ color: "var(--accent-blue)" }}>
          {bareName}
        </span>
        {displayTitle && (
          <span className={styles.fileName} data-testid="tool-card-task-title">
            &quot;{displayTitle}&quot;
          </span>
        )}
        {!displayTitle && argData.taskId && (
          <span className={styles.fileName} data-testid="tool-card-task-id">
            {argData.taskId}
          </span>
        )}
        {displayStatus && (
          <>
            <span className={styles.spacer} />
            <span
              className={styles.badge}
              style={{ color: statusColor(displayStatus) }}
              data-testid="tool-card-task-status"
            >
              {statusIcon(displayStatus)} {displayStatus}
            </span>
          </>
        )}
        {list && !displayStatus && (
          <>
            <span className={styles.spacer} />
            <span className={styles.badge} data-testid="tool-card-task-count">
              {list.length} {list.length === 1 ? "task" : "tasks"}
            </span>
          </>
        )}
        {!inProgress && !isError && result && (
          <CopyButton text={result} data-testid="tool-card-copy" className={styles.copyButtonInline} />
        )}
      </div>

      {/* In-progress: show args */}
      {inProgress && !displayTitle && !argData.taskId && args !== null && args !== undefined && (
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

      {/* Session ID from task_start */}
      {!isError && sessionId && (
        <div className={styles.pre} style={{ padding: "4px 8px", fontSize: "0.85em" }} data-testid="tool-card-task-session">
          session: {sessionId}
        </div>
      )}

      {/* Single task: show key fields */}
      {!isError && single && !list && !sessionId && (
        <pre className={styles.pre} data-testid="tool-card-task-detail">
          {[
            single.id ? `id: ${single.id}` : null,
            single.status ? `status: ${single.status}` : null,
            single.branch ? `branch: ${single.branch}` : null,
            single.latestSessionId ? `session: ${single.latestSessionId}` : null,
          ].filter(Boolean).join("\n")}
        </pre>
      )}

      {/* Task list */}
      {!isError && list && list.length > 0 && (
        <>
          <pre className={styles.pre} data-testid="tool-card-task-list">
            {(expanded ? list : list.slice(0, PREVIEW_COUNT)).map((t) => {
              const icon = statusIcon(t.status);
              const title = t.title ?? t.id ?? "untitled";
              return `${icon} ${title}`;
            }).join("\n")}
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
              {expanded ? "collapse" : `${list.length - PREVIEW_COUNT} more tasks`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
