import { GrackleProvider } from "./context/GrackleContext.js";
import { StatusBar } from "./components/StatusBar.js";
import { EnvironmentList } from "./components/EnvironmentList.js";
import { SessionPanel } from "./components/SessionPanel.js";
import { SpawnBar } from "./components/SpawnBar.js";
import { useState } from "react";

function AppContent() {
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "monospace", color: "#e0e0e0", background: "#1a1a2e" }}>
      <StatusBar />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <EnvironmentList
          onSelectSession={setSelectedSession}
          selectedSession={selectedSession}
        />
        <SessionPanel sessionId={selectedSession} />
      </div>
      <SpawnBar />
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
