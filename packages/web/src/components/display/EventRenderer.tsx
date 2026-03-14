import { useState, type JSX } from "react";
import Markdown from "react-markdown";
import rehypePrismPlus from "rehype-prism-plus/common";
import remarkGfm from "remark-gfm";
import type { SessionEvent } from "../../hooks/useGrackleSocket.js";
import styles from "./EventRenderer.module.scss";

/** Props for the EventRenderer component. */
interface Props {
  event: SessionEvent;
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

/** Renders a tool invocation event with parsed arguments. */
function ToolUseEvent({ content }: { content: string }): JSX.Element {
  let display = content;
  try {
    const parsed = JSON.parse(content);
    display = `${parsed.tool}: ${JSON.stringify(parsed.args, null, 2)}`;
  } catch { /* use raw */ }
  return (
    <div className={styles.toolUseEvent}>
      <span className={styles.toolUsePrefix}>&gt;</span> {display}
    </div>
  );
}

/** Number of lines shown in the collapsed preview. */
const PREVIEW_LINES: number = 5;

/** Renders a tool result event with an inline preview and a click-to-expand accordion. */
function ToolResultEvent({ content, raw }: { content: string; raw?: string }): JSX.Element {
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

  const headerContent = (
    <>
      <span
        className={isError ? styles.toolResultIndicatorError : styles.toolResultIndicatorOk}
        aria-label={isError ? "error" : "success"}
      >
        {isError ? "\u2717" : "\u2713"}
      </span>
      <span className={styles.toolResultLabel}>
        {isError ? "Tool error" : "Tool output"}
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
export function EventRenderer({ event }: Props): JSX.Element {
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
      return <ToolResultEvent content={event.content} raw={event.raw} />;
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
