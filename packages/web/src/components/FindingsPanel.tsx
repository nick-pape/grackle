import type { JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";

const CATEGORY_COLORS: Record<string, string> = {
  architecture: "#70a1ff",
  api: "#4ecca3",
  bug: "#e94560",
  decision: "#f0c040",
  dependency: "#a855f7",
  pattern: "#a0a0a0",
  general: "#888",
};

interface Props {
  projectId: string;
}

export function FindingsPanel({ projectId }: Props): JSX.Element {
  const { findings } = useGrackle();

  const projectFindings = findings.filter((f) => f.projectId === projectId);

  if (projectFindings.length === 0) {
    return (
      <div style={{ padding: "24px", color: "#666", textAlign: "center" }}>
        No findings yet. Agents will post discoveries here.
      </div>
    );
  }

  return (
    <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
      {projectFindings.map((f) => (
        <div
          key={f.id}
          style={{
            background: "#0f3460",
            border: "1px solid #1a1a4e",
            borderRadius: "6px",
            padding: "10px 12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "3px",
                background: CATEGORY_COLORS[f.category] || "#888",
                color: "#1a1a2e",
                fontWeight: "bold",
                textTransform: "uppercase",
              }}
            >
              {f.category}
            </span>
            <span style={{ fontSize: "13px", fontWeight: "bold", color: "#e0e0e0" }}>
              {f.title}
            </span>
            <span style={{ marginLeft: "auto", fontSize: "10px", color: "#666" }}>
              {f.createdAt}
            </span>
          </div>
          <div style={{ fontSize: "12px", color: "#a0a0a0", whiteSpace: "pre-wrap" }}>
            {f.content.length > 300 ? f.content.slice(0, 300) + "..." : f.content}
          </div>
          {f.tags.length > 0 && (
            <div style={{ marginTop: "4px", display: "flex", gap: "4px" }}>
              {f.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: "9px",
                    padding: "1px 4px",
                    borderRadius: "2px",
                    background: "#1a1a2e",
                    color: "#888",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
