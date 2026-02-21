import type { TaskDiffData } from "../hooks/useGrackleSocket.js";

interface Props {
  diff: TaskDiffData | null;
}

export function DiffViewer({ diff }: Props) {
  if (!diff) {
    return (
      <div style={{ padding: "24px", color: "#666", textAlign: "center" }}>
        Loading diff...
      </div>
    );
  }

  if (diff.error) {
    return (
      <div style={{ padding: "24px", color: "#e94560", textAlign: "center" }}>
        {diff.error}
      </div>
    );
  }

  if (!diff.diff || diff.diff.trim() === "") {
    return (
      <div style={{ padding: "24px", color: "#666", textAlign: "center" }}>
        No changes on branch {diff.branch}
      </div>
    );
  }

  const lines = diff.diff.split("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Stats bar */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #0f3460",
          fontSize: "12px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          color: "#a0a0a0",
        }}
      >
        <span>Branch: <b style={{ color: "#4ecca3" }}>{diff.branch}</b></span>
        <span>Files: <b>{diff.changedFiles?.length || 0}</b></span>
        <span style={{ color: "#4ecca3" }}>+{diff.additions || 0}</span>
        <span style={{ color: "#e94560" }}>-{diff.deletions || 0}</span>
      </div>

      {/* File list */}
      {diff.changedFiles && diff.changedFiles.length > 0 && (
        <div
          style={{
            padding: "4px 12px",
            borderBottom: "1px solid #0f3460",
            fontSize: "11px",
            color: "#888",
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          {diff.changedFiles.map((f) => (
            <span key={f} style={{ color: "#70a1ff" }}>{f}</span>
          ))}
        </div>
      )}

      {/* Diff content */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          fontFamily: "monospace",
          fontSize: "12px",
          lineHeight: "1.5",
        }}
      >
        {lines.map((line, i) => {
          let bg = "transparent";
          let color = "#a0a0a0";

          if (line.startsWith("+") && !line.startsWith("+++")) {
            bg = "rgba(78, 204, 163, 0.1)";
            color = "#4ecca3";
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            bg = "rgba(233, 69, 96, 0.1)";
            color = "#e94560";
          } else if (line.startsWith("@@")) {
            color = "#70a1ff";
          } else if (line.startsWith("diff ") || line.startsWith("index ")) {
            color = "#888";
          }

          return (
            <div
              key={i}
              style={{
                padding: "0 12px",
                background: bg,
                color,
                whiteSpace: "pre",
                minHeight: "18px",
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
}
