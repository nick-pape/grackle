import { GrackleProvider } from "./context/GrackleContext.js";
import { MockGrackleProvider } from "./mocks/MockGrackleProvider.js";
import { ToastProvider } from "./context/ToastContext.js";
import { ThemeProvider } from "./context/ThemeContext.js";
import { StatusBar, Sidebar, UnifiedBar } from "./components/layout/index.js";
import { ToastContainer } from "./components/notifications/index.js";
import { useEffect, type JSX } from "react";
import { useGrackle } from "./context/GrackleContext.js";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router";
import { sessionUrl, useAppNavigate } from "./utils/navigation.js";
import { EmptyPage } from "./pages/EmptyPage.js";
import { NewChatPage } from "./pages/NewChatPage.js";
import { SessionPage } from "./pages/SessionPage.js";
import { ProjectPage } from "./pages/ProjectPage.js";
import { NewTaskPage } from "./pages/NewTaskPage.js";
import { TaskEditPage } from "./pages/TaskEditPage.js";
import { TaskPage } from "./pages/TaskPage.js";
import { NewEnvironmentPage } from "./pages/NewEnvironmentPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { SettingsNav } from "./components/settings/SettingsNav.js";
import { SettingsEnvironmentsTab } from "./pages/settings/SettingsEnvironmentsTab.js";
import { SettingsTokensTab } from "./pages/settings/SettingsTokensTab.js";
import { SettingsPersonasTab } from "./pages/settings/SettingsPersonasTab.js";
import { SettingsAppearanceTab } from "./pages/settings/SettingsAppearanceTab.js";
import { SettingsAboutTab } from "./pages/settings/SettingsAboutTab.js";
import styles from "./App.module.scss";

/** Whether the app is running in mock mode (`?mock` query parameter). */
const IS_MOCK_MODE: boolean =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock");

/** Application shell layout with StatusBar, Sidebar, Outlet, and UnifiedBar. */
function AppShell(): JSX.Element {
  const { lastSpawnedId } = useGrackle();
  const navigate = useAppNavigate();

  const location = useLocation();
  const isSettings = location.pathname.startsWith("/settings");

  // Auto-select newly spawned sessions — but only if the user is not
  // already viewing a task (task-spawned sessions should keep the user on
  // the task page rather than redirecting to the raw session view).
  useEffect(() => {
    if (lastSpawnedId && !location.pathname.startsWith("/tasks/")) {
      navigate(sessionUrl(lastSpawnedId), { replace: true });
    }
  }, [lastSpawnedId, navigate, location.pathname]);

  return (
    <div className={styles.root}>
      <StatusBar />
      <div className={styles.body}>
        {isSettings ? <SettingsNav /> : <Sidebar />}
        <div className={styles.main}>
          <Outlet />
          <UnifiedBar />
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

/** Route configuration for the application. */
function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<EmptyPage />} />
        <Route path="sessions/new" element={<NewChatPage />} />
        <Route path="sessions/:sessionId" element={<SessionPage />} />
        <Route path="projects/:projectId" element={<ProjectPage />} />
        <Route path="tasks/new" element={<NewTaskPage />} />
        <Route path="tasks/:taskId" element={<TaskPage />} />
        <Route path="tasks/:taskId/stream" element={<TaskPage />} />
        <Route path="tasks/:taskId/findings" element={<TaskPage />} />
        <Route path="tasks/:taskId/edit" element={<TaskEditPage />} />
        <Route path="environments/new" element={<NewEnvironmentPage />} />
        <Route path="settings" element={<SettingsPage />}>
          <Route index element={<Navigate to="environments" replace />} />
          <Route path="environments" element={<SettingsEnvironmentsTab />} />
          <Route path="tokens" element={<SettingsTokensTab />} />
          <Route path="personas" element={<SettingsPersonasTab />} />
          <Route path="appearance" element={<SettingsAppearanceTab />} />
          <Route path="about" element={<SettingsAboutTab />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** Root application component with context providers and router. */
export default function App(): JSX.Element {
  const Provider = IS_MOCK_MODE ? MockGrackleProvider : GrackleProvider;
  return (
    <ThemeProvider>
      <ToastProvider>
        <Provider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </Provider>
      </ToastProvider>
    </ThemeProvider>
  );
}
