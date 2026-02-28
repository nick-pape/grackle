import type { JSX } from "react";
import type { SessionEvent } from "../hooks/useGrackleSocket.js";
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

/** Renders an assistant text output event. */
function TextEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.textEvent}>
      {content}
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

/** Renders a collapsible tool result event. */
function ToolResultEvent({ content }: { content: string }): JSX.Element {
  return (
    <details className={styles.toolResultEvent}>
      <summary className={styles.toolResultSummary}>Tool output</summary>
      <pre className={styles.toolResultPre}>
        {content}
      </pre>
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
      return <TextEvent content={event.content} />;
    case "tool_use":
      return <ToolUseEvent content={event.content} />;
    case "tool_result":
      return <ToolResultEvent content={event.content} />;
    case "error":
      return <ErrorEvent content={event.content} />;
    case "status":
      return <StatusEvent content={event.content} />;
    default:
      return <DefaultEvent content={event.content} />;
  }
}
