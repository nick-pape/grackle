import type { SessionEvent } from "../hooks/useGrackleSocket.js";

interface Props {
  event: SessionEvent;
}

export function EventRenderer({ event }: Props) {
  const time = new Date(event.timestamp).toLocaleTimeString();

  switch (event.eventType) {
    case "system":
      return (
        <div style={{ color: "#888", fontStyle: "italic", fontSize: "12px", padding: "2px 0" }}>
          <span style={{ color: "#666" }}>[{time}]</span> {event.content}
        </div>
      );

    case "text":
      return (
        <div style={{ padding: "4px 0", whiteSpace: "pre-wrap", lineHeight: "1.4" }}>
          {event.content}
        </div>
      );

    case "tool_use": {
      let display = event.content;
      try {
        const parsed = JSON.parse(event.content);
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

    case "tool_result":
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
            {event.content}
          </pre>
        </details>
      );

    case "error":
      return (
        <div style={{ color: "#e94560", fontWeight: "bold", padding: "4px 0" }}>
          Error: {event.content}
        </div>
      );

    case "status":
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
          --- {event.content} ---
        </div>
      );

    default:
      return (
        <div style={{ padding: "2px 0", color: "#ccc" }}>{event.content}</div>
      );
  }
}
