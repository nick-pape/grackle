import { GrackleProvider } from "./context/GrackleContext.js";
import { StatusBar } from "./components/StatusBar.js";
import { EnvironmentList } from "./components/EnvironmentList.js";
import { SessionPanel } from "./components/SessionPanel.js";
import { UnifiedBar } from "./components/UnifiedBar.js";
import { useState, useEffect } from "react";
import { useGrackle } from "./context/GrackleContext.js";

export type ViewMode =
  | { kind: "empty" }
  | { kind: "new_chat"; envId: string; runtime: string }
  | { kind: "session"; sessionId: string };

function AppContent() {
  const [viewMode, setViewMode] = useState<ViewMode>({ kind: "empty" });
  const { lastSpawnedId } = useGrackle();

  // Auto-select newly spawned sessions
  useEffect(() => {
    if (lastSpawnedId) {
      setViewMode({ kind: "session", sessionId: lastSpawnedId });
    }
  }, [lastSpawnedId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "monospace", color: "#e0e0e0", background: "#1a1a2e" }}>
      <StatusBar />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <EnvironmentList viewMode={viewMode} setViewMode={setViewMode} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <SessionPanel viewMode={viewMode} />
          <UnifiedBar viewMode={viewMode} setViewMode={setViewMode} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <GrackleProvider>
      <AppContent />
    </GrackleProvider>
  );
}
