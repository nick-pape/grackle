import type { JSX } from "react";
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

/** Renders a tool invocation event with structured display. */
function ToolUseEvent({ content }: { content: string }): JSX.Element {
  let toolName = "";
  let argsDisplay = content;
  try {
    const parsed = JSON.parse(content);
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

/** Detects if content looks like a unified diff. */
function isDiffContent(text: string): boolean {
  return text.includes("diff --git") || text.includes("--- a/");
}

/** Renders a collapsible tool result event with intelligent formatting. */
function ToolResultEvent({ content }: { content: string }): JSX.Element {
  // Try to detect content type and render appropriately
  let formattedContent: JSX.Element;

  try {
    // Attempt JSON parse — render as highlighted JSON
    JSON.parse(content);
    formattedContent = (
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypePrismPlus]}>
        {"```json\n" + content + "\n```"}
      </Markdown>
    );
  } catch {
    if (isDiffContent(content)) {
      // Diff output — render with diff syntax highlighting
      formattedContent = (
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypePrismPlus]}>
          {"```diff\n" + content + "\n```"}
        </Markdown>
      );
    } else {
      // Fallback — raw text
      formattedContent = <pre className={styles.toolResultPre}>{content}</pre>;
    }
  }

  return (
    <details className={styles.toolResultEvent}>
      <summary className={styles.toolResultSummary}>Tool output</summary>
      <div className={styles.toolResultContent}>
        {formattedContent}
      </div>
    </details>
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
      return <ToolResultEvent content={event.content} />;
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
