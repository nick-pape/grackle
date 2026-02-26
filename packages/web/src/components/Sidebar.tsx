import { useState, type JSX } from "react";
import { EnvironmentList } from "./EnvironmentList.js";
import { ProjectList } from "./ProjectList.js";
import type { ViewMode } from "../App.js";

interface Props {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

type SidebarTab = "projects" | "environments";

export function Sidebar({ viewMode, setViewMode }: Props): JSX.Element {
  const [tab, setTab] = useState<SidebarTab>("projects");

  return (
    <div
      style={{
        width: "260px",
        minWidth: "260px",
        borderRight: "1px solid #0f3460",
        display: "flex",
        flexDirection: "column",
        background: "#16213e",
      }}
    >
      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #0f3460" }}>
        <TabButton active={tab === "projects"} onClick={() => setTab("projects")}>
          Projects
        </TabButton>
        <TabButton active={tab === "environments"} onClick={() => setTab("environments")}>
          Environments
        </TabButton>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "projects" ? (
          <ProjectList viewMode={viewMode} setViewMode={setViewMode} />
        ) : (
          <EnvironmentList viewMode={viewMode} setViewMode={setViewMode} />
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "6px 0",
        background: active ? "#0f3460" : "transparent",
        border: "none",
        color: active ? "#4ecca3" : "#888",
        cursor: "pointer",
        fontFamily: "monospace",
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "1px",
        borderBottom: active ? "2px solid #4ecca3" : "2px solid transparent",
      }}
    >
      {children}
    </button>
  );
}
