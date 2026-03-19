import { GrackleProvider } from "./context/GrackleContext.js";
import { MockGrackleProvider } from "./mocks/MockGrackleProvider.js";
import { ToastProvider } from "./context/ToastContext.js";
import { ThemeProvider } from "./context/ThemeContext.js";
import { StatusBar, Sidebar, UnifiedBar } from "./components/layout/index.js";
import { ToastContainer } from "./components/notifications/index.js";
import { SplashScreen } from "./components/display/index.js";
import { useCallback, useEffect, useState, type JSX } from "react";
import { useGrackle } from "./context/GrackleContext.js";
import { useToast } from "./context/ToastContext.js";
import { useEnvironmentToasts } from "./hooks/useEnvironmentToasts.js";
import { AnimatePresence, motion } from "motion/react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router";
import { sessionUrl, SETTINGS_URL, useAppNavigate } from "./utils/navigation.js";
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
import { SettingsCredentialsTab } from "./pages/settings/SettingsCredentialsTab.js";
import { SettingsPersonasTab } from "./pages/settings/SettingsPersonasTab.js";
import { SettingsAppearanceTab } from "./pages/settings/SettingsAppearanceTab.js";
import { SettingsAboutTab } from "./pages/settings/SettingsAboutTab.js";
import { SetupWizard } from "./pages/SetupWizard.js";
import styles from "./App.module.scss";

/** Whether the app is running in mock mode (`?mock` query parameter). */
const IS_MOCK_MODE: boolean =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock");

/** Application shell layout with StatusBar, Sidebar, Outlet, and UnifiedBar. */
function AppShell(): JSX.Element {
  const { lastSpawnedId, environments, connected, onboardingCompleted } = useGrackle();
  const { showToast } = useToast();
  useEnvironmentToasts(environments, showToast);
  const navigate = useAppNavigate();

  const location = useLocation();
  const isSettings = location.pathname.startsWith(SETTINGS_URL);

  // Sidebar drawer state for mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);

  // Auto-close sidebar on navigation (mobile drawer)
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  // Close sidebar on Escape key
  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setSidebarOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); };
  }, [sidebarOpen]);

  // Auto-select newly spawned sessions — but only if the user is not
  // already viewing a task (task-spawned sessions should keep the user on
  // the task page rather than redirecting to the raw session view).
  useEffect(() => {
    if (lastSpawnedId && !location.pathname.startsWith("/tasks/")) {
      navigate(sessionUrl(lastSpawnedId), { replace: true });
    }
  }, [lastSpawnedId, navigate, location.pathname]);

  // Redirect to setup wizard if onboarding hasn't been completed
  if (connected && onboardingCompleted === false) {
    return <Navigate to="/setup" replace />;
  }

  return (
    <div className={styles.root}>
      <StatusBar onToggleSidebar={isSettings ? undefined : toggleSidebar} sidebarOpen={sidebarOpen} />
      <div className={styles.body}>
        <div
          className={styles.sidebarWrapper}
          data-sidebar-open={sidebarOpen}
          data-settings={isSettings}
        >
          {isSettings ? <SettingsNav /> : <Sidebar />}
        </div>
        {sidebarOpen && !isSettings && (
          <div
            className={styles.overlay}
            data-testid="drawer-overlay"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div className={styles.main}>
          <Outlet />
          <UnifiedBar />
        </div>
      </div>
      {/* Toast messages (including environment status toasts from
          useEnvironmentToasts) are intentionally generic — no resource names —
          so that getByText() locators in E2E tests remain unique and
          strict-mode safe. Use { exact: true } or data-testid selectors in
          tests when matching resource names that may also appear in transient
          toasts. */}
      <ToastContainer />
    </div>
  );
}

/** Route configuration for the application. */
function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="setup" element={<SetupWizard />} />
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
          <Route path="credentials" element={<SettingsCredentialsTab />} />
          <Route path="tokens" element={<Navigate to="../credentials" replace />} />
          <Route path="personas" element={<SettingsPersonasTab />} />
          <Route path="appearance" element={<SettingsAppearanceTab />} />
          <Route path="about" element={<SettingsAboutTab />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** Gates the app behind a splash screen until the server's initial state arrives. */
function AppContent(): JSX.Element {
  const { onboardingCompleted } = useGrackle();
  return (
    <AnimatePresence mode="wait">
      {onboardingCompleted === undefined ? (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <SplashScreen />
        </motion.div>
      ) : (
        <motion.div
          key="app"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          style={{ minHeight: "100vh" }}
        >
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Root application component with context providers and router. */
export default function App(): JSX.Element {
  const Provider = IS_MOCK_MODE ? MockGrackleProvider : GrackleProvider;
  return (
    <ThemeProvider>
      <ToastProvider>
        <Provider>
          <AppContent />
        </Provider>
      </ToastProvider>
    </ThemeProvider>
  );
}
