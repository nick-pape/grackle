import type { JSX } from "react";
import type { SessionEvent } from "../hooks/useGrackleSocket.js";

interface Props {
  event: SessionEvent;
}

// --- Individual event type renderers ---

function SystemEvent({ time, content }: { time: string; content: string }): JSX.Element {
  return (
    <div style={{ color: "#888", fontStyle: "italic", fontSize: "12px", padding: "2px 0" }}>
      <span style={{ color: "#666" }}>[{time}]</span> {content}
    </div>
  );
}

function TextEvent({ content }: { content: string }): JSX.Element {
  return (
    <div style={{ padding: "4px 0", whiteSpace: "pre-wrap", lineHeight: "1.4" }}>
      {content}
    </div>
  );
}

function ToolUseEvent({ content }: { content: string }): JSX.Element {
  let display = content;
  try {
    const parsed = JSON.parse(content);
    display = `${parsed.tool}: ${JSON.stringify(parsed.args, null, 2)}`;
  } catch { /* use raw */ }
  return (
    <div
      style={{
        background: "#0f3460",
        borderLeft: "3px solid #70a1ff",
        padding: "6px 10px",
        margin: "4px 0",
        fontSize: "12px",
        fontFamily: "monospace",
        whiteSpace: "pre-wrap",
        borderRadius: "2px",
      }}
    >
      <span style={{ color: "#70a1ff" }}>&gt;</span> {display}
    </div>
  );
}

function ToolResultEvent({ content }: { content: string }): JSX.Element {
  return (
    <details style={{ margin: "2px 0", fontSize: "12px" }}>
      <summary style={{ cursor: "pointer", color: "#888" }}>Tool output</summary>
      <pre
        style={{
          background: "#111",
          padding: "8px",
          margin: "4px 0",
          overflow: "auto",
          maxHeight: "200px",
          fontSize: "11px",
          borderRadius: "2px",
        }}
      >
        {content}
      </pre>
    </details>
  );
}

function ErrorEvent({ content }: { content: string }): JSX.Element {
  return (
    <div style={{ color: "#e94560", fontWeight: "bold", padding: "4px 0" }}>
      Error: {content}
    </div>
  );
}

function StatusEvent({ content }: { content: string }): JSX.Element {
  return (
    <div
      style={{
        color: "#f0c040",
        fontSize: "11px",
        padding: "4px 0",
        borderTop: "1px solid #333",
        borderBottom: "1px solid #333",
        margin: "4px 0",
      }}
    >
      --- {content} ---
    </div>
  );
}

function DefaultEvent({ content }: { content: string }): JSX.Element {
  return (
    <div style={{ padding: "2px 0", color: "#ccc" }}>{content}</div>
  );
}

// --- Main component ---

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
