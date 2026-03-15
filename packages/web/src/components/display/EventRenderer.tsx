import { useState, type JSX } from "react";
import Markdown from "react-markdown";
import rehypePrismPlus from "rehype-prism-plus/common";
import remarkGfm from "remark-gfm";
import type { SessionEvent } from "../../hooks/useGrackleSocket.js";
import styles from "./EventRenderer.module.scss";

/** Props for the EventRenderer component. */
interface Props {
  event: SessionEvent;
  /** Paired tool_use context, attached by SessionPanel when raw IDs match. */
  toolUseCtx?: { tool: string; args: unknown };
}

// --- Individual event type renderers ---

/** Renders a system-level event with timestamp. */
function SystemEvent({ time, content }: { time: string; content: string }): JSX.Element {
  return (
    <div className={styles.systemEvent}>
      <span className={styles.systemTimestamp}>[{time}]</span> {content}
    </div>
  );
}

/** Renders an assistant text output event with markdown formatting. */
function TextEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.textEvent}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypePrismPlus]}>
        {content}
      </Markdown>
    </div>
  );
}

/** Renders a tool invocation event with structured display. */
function ToolUseEvent({ content }: { content: string }): JSX.Element {
  let toolName = "";
  let argsDisplay = content;
  try {
    const parsed = JSON.parse(content) as { tool?: string; args?: unknown };
    toolName = parsed.tool || "";
    argsDisplay = JSON.stringify(parsed.args, null, 2);
  } catch { /* use raw */ }
  return (
    <div className={styles.toolUseEvent}>
      <div className={styles.toolUseHeader}>
        <span className={styles.toolUsePrefix}>&gt;</span>
        {toolName ? <span className={styles.toolUseName}>{toolName}</span> : null}
      </div>
      <pre className={styles.toolUseArgs}>{argsDisplay}</pre>
    </div>
  );
}

/** Number of lines shown in the collapsed preview. */
const PREVIEW_LINES: number = 5;

/** Extracts a one-line human-readable summary of tool arguments. */
function argsPreview(_tool: string, args: unknown): string {
  if (args === null || args === undefined) return "";
  if (typeof args !== "object") return String(args);
  const a = args as Record<string, unknown>;
  // Bash / shell: show the command string
  if (typeof a.command === "string") return a.command;
  // File-path tools (Read, Write, Edit, Glob)
  if (typeof a.file_path === "string") return a.file_path;
  // Search tools (Grep)
  if (typeof a.pattern === "string") {
    const inPath = typeof a.path === "string" ? ` in ${a.path}` : "";
    return `${a.pattern}${inPath}`;
  }
  // Path-only tools
  if (typeof a.path === "string") return a.path;
  // Query-based tools
  if (typeof a.query === "string") return a.query;
  // General fallback: first 150 chars of JSON
  try {
    const json = JSON.stringify(args);
    return json.length > 150 ? `${json.slice(0, 150)}\u2026` : json;
  } catch {
    return "";
  }
}

/** Renders a tool result event with an inline preview and a click-to-expand accordion. */
function ToolResultEvent({ content, raw, toolUseCtx }: {
  content: string;
  raw?: string;
  toolUseCtx?: { tool: string; args: unknown };
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  let isError = false;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      isError = parsed.is_error === true;
    } catch { /* ignore malformed raw */ }
  }

  const lines = content.split("\n");
  const hasMore = lines.length > PREVIEW_LINES;
  const displayContent = expanded ? content : lines.slice(0, PREVIEW_LINES).join("\n");

  // Use the paired tool name when available; fall back to generic label
  const toolName = toolUseCtx?.tool ?? "";
  const label = toolName || (isError ? "Tool error" : "Tool output");
  const cmdLine = toolUseCtx ? argsPreview(toolUseCtx.tool, toolUseCtx.args) : "";

  const headerContent = (
    <>
      <span
        className={isError ? styles.toolResultIndicatorError : styles.toolResultIndicatorOk}
        aria-label={isError ? "error" : "success"}
      >
        {isError ? "\u2717" : "\u2713"}
      </span>
      <span className={styles.toolResultLabel}>
        {label}
      </span>
      {hasMore && (
        <span className={styles.toolResultToggle} aria-hidden="true">
          {expanded ? "\u25be" : "\u25b8"}
        </span>
      )}
    </>
  );

  return (
    <div className={styles.toolResultEvent}>
      {hasMore ? (
        <button
          className={styles.toolResultHeader}
          onClick={() => { setExpanded((v) => !v); }}
          aria-expanded={expanded}
        >
          {headerContent}
        </button>
      ) : (
        <div className={styles.toolResultHeader}>
          {headerContent}
        </div>
      )}
      {cmdLine && (
        <div className={styles.toolResultCommand}>{cmdLine}</div>
      )}
      <pre className={styles.toolResultPre}>
        {displayContent}
        {!expanded && hasMore && (
          <span className={styles.toolResultEllipsis}>{"\u2026"}</span>
        )}
      </pre>
    </div>
  );
}

/** Renders an error event with red styling. */
function ErrorEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.errorEvent}>
      Error: {content}
    </div>
  );
}

/** Renders a status change event with separator lines. */
function StatusEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.statusEvent}>
      --- {content} ---
    </div>
  );
}

/** Renders a user input event, right-aligned to distinguish it from agent output. */
function UserInputEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.userInputEvent}>
      <span className={styles.userInputContent}>{content}</span>
    </div>
  );
}

/** Renders an unrecognized event type. */
function DefaultEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.defaultEvent}>{content}</div>
  );
}

// --- Main component ---

/** Renders a single session event, dispatching to the appropriate type-specific renderer. */
export function EventRenderer({ event, toolUseCtx }: Props): JSX.Element {
  const time = new Date(event.timestamp).toLocaleTimeString();

  switch (event.eventType) {
    case "system":
      return <SystemEvent time={time} content={event.content} />;
    case "text":
    case "output":
      return <TextEvent content={event.content} />;
    case "tool_use":
      return <ToolUseEvent content={event.content} />;
    case "tool_result":
      return <ToolResultEvent content={event.content} raw={event.raw} toolUseCtx={toolUseCtx} />;
    case "error":
      return <ErrorEvent content={event.content} />;
    case "status":
      return <StatusEvent content={event.content} />;
    case "user_input":
      return <UserInputEvent content={event.content} />;
    default:
      return <DefaultEvent content={event.content} />;
  }
}
