import { GrackleProvider } from "./context/GrackleContext.js";
import { MockGrackleProvider } from "./mocks/MockGrackleProvider.js";
import { ToastProvider } from "./context/ToastContext.js";
import { StatusBar, Sidebar, UnifiedBar } from "./components/layout/index.js";
import { SessionPanel } from "./components/panels/index.js";
import { ToastContainer } from "./components/notifications/index.js";
import { useState, useEffect, type JSX } from "react";
import { useGrackle } from "./context/GrackleContext.js";
import styles from "./App.module.scss";

/** Whether the app is running in mock mode (`?mock` query parameter). */
const IS_MOCK_MODE: boolean =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock");

export type ViewMode =
  | { kind: "empty" }
  | { kind: "new_chat"; environmentId: string; runtime: string }
  | { kind: "session"; sessionId: string }
  | { kind: "project"; projectId: string }
  | { kind: "new_task"; projectId: string; parentTaskId?: string }
  | { kind: "task"; taskId: string; tab?: "stream" | "findings" }
  | { kind: "new_environment" }
  | { kind: "settings" };

/** Main application content with layout and view routing. */
function AppContent(): JSX.Element {
  const [viewMode, setViewMode] = useState<ViewMode>({ kind: "empty" });
  const { lastSpawnedId } = useGrackle();

  // Auto-select newly spawned sessions
  useEffect(() => {
    if (lastSpawnedId) {
      setViewMode({ kind: "session", sessionId: lastSpawnedId });
    }
  }, [lastSpawnedId]);

  return (
    <div className={styles.root}>
      <StatusBar setViewMode={setViewMode} />
      <div className={styles.body}>
        <Sidebar viewMode={viewMode} setViewMode={setViewMode} />
        <div className={styles.main}>
          <SessionPanel
            key={viewMode.kind === "task" ? viewMode.taskId : viewMode.kind === "session" ? viewMode.sessionId : viewMode.kind}
            viewMode={viewMode}
            setViewMode={setViewMode}
          />
          <UnifiedBar viewMode={viewMode} setViewMode={setViewMode} />
        </div>
      </div>
      {/* Toast messages are intentionally generic (no resource names) so
          that getByText() locators in E2E tests remain unique and strict-mode
          safe. Use { exact: true } or data-testid selectors in tests when
          matching resource names that may also appear in transient toasts. */}
      <ToastContainer />
    </div>
  );
}

/** Root application component with context provider. Uses MockGrackleProvider when `?mock` is present. */
export default function App(): JSX.Element {
  const Provider = IS_MOCK_MODE ? MockGrackleProvider : GrackleProvider;
  return (
    <ToastProvider>
      <Provider>
        <AppContent />
      </Provider>
    </ToastProvider>
  );
}
