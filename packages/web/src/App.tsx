import { GrackleProvider } from "./context/GrackleContext.js";
import { MockGrackleProvider } from "./mocks/MockGrackleProvider.js";
import { ToastProvider } from "./context/ToastContext.js";
import { ThemeProvider } from "./context/ThemeContext.js";
import { StatusBar, AppNav, Sidebar, WithTaskSidebar, WithEnvironmentSidebar, WithSettingsSidebar, WithKnowledgeSidebar, BottomStatusBar } from "./components/layout/index.js";
import { SidebarProvider, useSidebarContent } from "./context/SidebarContext.js";
import { ToastContainer } from "./components/notifications/index.js";
import { SplashScreen } from "./components/display/index.js";
import { useCallback, useEffect, useState, Suspense, lazy, type LazyExoticComponent, type JSX } from "react";
import { useGrackle } from "./context/GrackleContext.js";
import { useToast } from "./context/ToastContext.js";
import { useEnvironmentToasts } from "./hooks/useEnvironmentToasts.js";
import { AnimatePresence, motion } from "motion/react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useParams } from "react-router";
import { sessionUrl, useAppNavigate } from "./utils/navigation.js";
import { EmptyPage, TasksEmptyPage, EnvironmentsEmptyPage } from "./pages/EmptyPage.js";
import { ChatPage } from "./pages/ChatPage.js";
import { NewChatPage } from "./pages/NewChatPage.js";
import { SessionPage } from "./pages/SessionPage.js";
import { WorkspacePage } from "./pages/WorkspacePage.js";
import { WorkspaceCreatePage } from "./pages/WorkspaceCreatePage.js";
import { NewTaskPage } from "./pages/NewTaskPage.js";
import { TaskEditPage } from "./pages/TaskEditPage.js";
import { TaskPage } from "./pages/TaskPage.js";
import { NewEnvironmentPage } from "./pages/NewEnvironmentPage.js";
import { EnvironmentEditPage } from "./pages/EnvironmentEditPage.js";
import { EnvironmentsPage } from "./pages/EnvironmentsPage.js";
import { EnvironmentDetailPage } from "./pages/EnvironmentDetailPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { SettingsCredentialsTab } from "./pages/settings/SettingsCredentialsTab.js";
import { SettingsPersonasTab } from "./pages/settings/SettingsPersonasTab.js";
import { SettingsAppearanceTab } from "./pages/settings/SettingsAppearanceTab.js";
import { SettingsAboutTab } from "./pages/settings/SettingsAboutTab.js";
import { SetupWizard } from "./pages/SetupWizard.js";
import styles from "./App.module.scss";

// Lazy-loaded to keep the main bundle under the chunk size limit
const KnowledgePage: LazyExoticComponent<() => JSX.Element> = lazy(() => import("./pages/KnowledgePage.js").then((m) => ({ default: m.KnowledgePage })));

/** Whether the app is running in mock mode (`?mock` query parameter). */
const IS_MOCK_MODE: boolean =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock");

/** Inner layout body that conditionally renders the sidebar based on context content. */
function AppShellBody(): JSX.Element {
  const location = useLocation();
  const sidebarContent = useSidebarContent();
  const hasSidebar = sidebarContent !== undefined;

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

  return (
    <>
      <StatusBar onToggleSidebar={hasSidebar ? toggleSidebar : undefined} sidebarOpen={sidebarOpen} />
      <AppNav />
      <div className={styles.body}>
        {hasSidebar && (
          <div
            className={styles.sidebarWrapper}
            data-sidebar-open={sidebarOpen}
          >
            <Sidebar />
          </div>
        )}
        {hasSidebar && sidebarOpen && (
          <div
            className={styles.overlay}
            data-testid="drawer-overlay"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div className={styles.main}>
          <Outlet />
          <BottomStatusBar />
        </div>
      </div>
      {/* Toast messages (including environment status toasts from
          useEnvironmentToasts) are intentionally generic — no resource names —
          so that getByText() locators in E2E tests remain unique and
          strict-mode safe. Use { exact: true } or data-testid selectors in
          tests when matching resource names that may also appear in transient
          toasts. */}
      <ToastContainer />
    </>
  );
}

/** Application shell layout with StatusBar, Sidebar, Outlet, and BottomStatusBar. */
function AppShell(): JSX.Element {
  const { lastSpawnedId, environments, connected, onboardingCompleted } = useGrackle();
  const { showToast } = useToast();
  useEnvironmentToasts(environments, showToast);
  const navigate = useAppNavigate();

  const location = useLocation();

  // Auto-select newly spawned sessions — but only if the user is not
  // already viewing a task (task-spawned sessions should keep the user on
  // the task page rather than redirecting to the raw session view).
  useEffect(() => {
    if (lastSpawnedId && !location.pathname.includes("/tasks/")) {
      navigate(sessionUrl(lastSpawnedId), { replace: true });
    }
  }, [lastSpawnedId, navigate, location.pathname]);

  // Redirect to setup wizard if onboarding hasn't been completed
  if (connected && onboardingCompleted === false) {
    return <Navigate to="/setup" replace />;
  }

  return (
    <SidebarProvider>
      <div className={styles.root}>
        <AppShellBody />
      </div>
    </SidebarProvider>
  );
}

/**
 * Redirect component for legacy `/workspaces/:workspaceId` URLs.
 * Looks up the workspace's environmentId and redirects to the new
 * `/environments/:envId/workspaces/:wsId` path, preserving sub-path,
 * query parameters, and hash.
 */
function WorkspaceRedirect(): JSX.Element | undefined {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { workspaces } = useGrackle();
  const location = useLocation();

  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace?.environmentId) {
    // Workspaces load asynchronously — avoid redirecting before data arrives.
    if (workspaces.length === 0) {
      return undefined;
    }
    return <Navigate to="/environments" replace />;
  }

  // Rewrite /workspaces/:wsId/... → /environments/:envId/workspaces/:wsId/...,
  // preserving query parameters and hash. Use encoded IDs for reliable matching.
  const encodedWorkspaceId = encodeURIComponent(workspaceId!);
  const encodedPrefix = `/workspaces/${encodedWorkspaceId}`;
  const suffix = location.pathname.startsWith(encodedPrefix)
    ? location.pathname.slice(encodedPrefix.length)
    : "";
  const target = `/environments/${encodeURIComponent(workspace.environmentId)}/workspaces/${encodedWorkspaceId}${suffix}${location.search}${location.hash}`;
  return <Navigate to={target} replace />;
}

/** Route configuration for the application. */
function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="setup" element={<SetupWizard />} />
      <Route element={<AppShell />}>
        {/* Pages without sidebar */}
        <Route index element={<EmptyPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="sessions/new" element={<NewChatPage />} />
        <Route path="sessions/:sessionId" element={<SessionPage />} />

        {/* Knowledge sidebar */}
        <Route element={<WithKnowledgeSidebar />}>
          <Route path="knowledge" element={<Suspense fallback={<SplashScreen />}><KnowledgePage /></Suspense>} />
        </Route>

        {/* Tasks sidebar */}
        <Route element={<WithTaskSidebar />}>
          <Route path="tasks" element={<TasksEmptyPage />} />
          <Route path="tasks/new" element={<NewTaskPage />} />
          <Route path="tasks/:taskId" element={<TaskPage />} />
          <Route path="tasks/:taskId/stream" element={<TaskPage />} />
          <Route path="tasks/:taskId/findings" element={<TaskPage />} />
          <Route path="tasks/:taskId/edit" element={<TaskEditPage />} />
        </Route>

        {/* Environments sidebar */}
        <Route element={<WithEnvironmentSidebar />}>
          <Route path="workspaces" element={<Navigate to="/environments" replace />} />
          <Route path="workspaces/new" element={<WorkspaceCreatePage />} />
          <Route path="workspaces/:workspaceId" element={<WorkspaceRedirect />} />
          <Route path="workspaces/:workspaceId/tasks/:taskId" element={<WorkspaceRedirect />} />
          <Route path="workspaces/:workspaceId/tasks/:taskId/*" element={<WorkspaceRedirect />} />
          <Route path="environments/:environmentId/workspaces/:workspaceId" element={<WorkspacePage />} />
          <Route path="environments/:environmentId/workspaces/:workspaceId/tasks/new" element={<NewTaskPage />} />
          <Route path="environments/:environmentId/workspaces/:workspaceId/tasks/:taskId" element={<TaskPage />} />
          <Route path="environments/:environmentId/workspaces/:workspaceId/tasks/:taskId/stream" element={<TaskPage />} />
          <Route path="environments/:environmentId/workspaces/:workspaceId/tasks/:taskId/findings" element={<TaskPage />} />
          <Route path="environments/:environmentId/workspaces/:workspaceId/tasks/:taskId/edit" element={<TaskEditPage />} />
          <Route path="environments" element={<EnvironmentsPage />}>
            <Route index element={<EnvironmentsEmptyPage />} />
            <Route path="new" element={<NewEnvironmentPage />} />
            <Route path=":environmentId" element={<EnvironmentDetailPage />} />
            <Route path=":environmentId/edit" element={<EnvironmentEditPage />} />
          </Route>
        </Route>

        {/* Settings sidebar */}
        <Route element={<WithSettingsSidebar />}>
          <Route path="settings" element={<SettingsPage />}>
            <Route index element={<Navigate to="credentials" replace />} />
            <Route path="environments" element={<Navigate to="/environments" replace />} />
            <Route path="credentials" element={<SettingsCredentialsTab />} />
            <Route path="tokens" element={<Navigate to="../credentials" replace />} />
            <Route path="personas" element={<SettingsPersonasTab />} />
            <Route path="appearance" element={<SettingsAppearanceTab />} />
            <Route path="about" element={<SettingsAboutTab />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** Maximum time (ms) to show the splash screen before falling through to the app. */
const SPLASH_TIMEOUT_MS: number = 10_000;

/** Gates the app behind a splash screen until the server's initial state arrives. */
function AppContent(): JSX.Element {
  const { onboardingCompleted } = useGrackle();
  const [timedOut, setTimedOut] = useState(false);

  // Safety-net timeout: if the server never responds, fall through to the app
  // after SPLASH_TIMEOUT_MS so the user isn't stuck on an infinite spinner.
  useEffect(() => {
    if (onboardingCompleted !== undefined) {
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), SPLASH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [onboardingCompleted]);

  const showSplash = onboardingCompleted === undefined && !timedOut;

  return (
    <AnimatePresence mode="wait">
      {showSplash ? (
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
