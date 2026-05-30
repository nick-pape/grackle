import { GrackleProvider } from "./context/GrackleContext.js";
import { ManifestProvider, useManifest } from "./context/ManifestContext.js";
import { buildTabs } from "./plugin-registry.js";
import {
  ToastProvider,
  ThemeProvider,
  SidebarProvider,
  StatusBar,
  AppNav,
  Sidebar,
  BottomStatusBar,
  ToastContainer,
  SplashScreen,
  DemoBanner,
  MockGrackleProvider,
  useSidebarContent,
  useToast,
  sessionUrl,
  personaUrl,
  useAppNavigate,
  type AppTab,
} from "@grackle-ai/web-components";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  Suspense,
  lazy,
  type LazyExoticComponent,
  type JSX,
} from "react";
import { useGrackle } from "./context/GrackleContext.js";
import { useEnvironmentToasts } from "./hooks/useEnvironmentToasts.js";
import { useEnvironmentOperationToasts } from "./hooks/useEnvironmentOperationToasts.js";
import { useTaskToasts } from "./hooks/useTaskToasts.js";
import { AnimatePresence, motion } from "motion/react";
import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
  useParams,
} from "react-router";
import { EmptyPage, TasksEmptyPage, EnvironmentsEmptyPage } from "./pages/EmptyPage.js";
import { ChatPage } from "./pages/ChatPage.js";
import { CoordinationPage } from "./pages/CoordinationPage.js";
import { NewChatPage } from "./pages/NewChatPage.js";
import { SessionPage } from "./pages/SessionPage.js";
import { WorkspacePage } from "./pages/WorkspacePage.js";
import { WorkspaceCreatePage } from "./pages/WorkspaceCreatePage.js";
import { NewTaskPage } from "./pages/NewTaskPage.js";
import { TaskPage } from "./pages/TaskPage.js";
import { NewEnvironmentPage } from "./pages/NewEnvironmentPage.js";
import { EnvironmentEditPage } from "./pages/EnvironmentEditPage.js";
import { EnvironmentsPage } from "./pages/EnvironmentsPage.js";
import { EnvironmentDetailPage } from "./pages/EnvironmentDetailPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { SettingsCredentialsTab } from "./pages/settings/SettingsCredentialsTab.js";
import { SettingsGitHubAccountsTab } from "./pages/settings/SettingsGitHubAccountsTab.js";
import { PersonaLibraryPage } from "./pages/PersonaLibraryPage.js";
import { PersonaDetailPage } from "./pages/PersonaDetailPage.js";
import { SettingsSchedulesTab } from "./pages/settings/SettingsSchedulesTab.js";
import { ScheduleDetailPage } from "./pages/settings/ScheduleDetailPage.js";
import { SettingsAppearanceTab } from "./pages/settings/SettingsAppearanceTab.js";
import { SettingsAboutTab } from "./pages/settings/SettingsAboutTab.js";
import { SettingsShortcutsTab } from "./pages/settings/SettingsShortcutsTab.js";
import { SettingsPluginsTab } from "./pages/settings/SettingsPluginsTab.js";
import { GlobalShortcuts } from "./components/layout/GlobalShortcuts.js";
import {
  WithTaskSidebar,
  WithEnvironmentSidebar,
  WithSettingsSidebar,
  WithKnowledgeSidebar,
} from "./components/layout/WithSidebar.js";
import { SetupWizard } from "./pages/SetupWizard.js";
import styles from "./App.module.scss";

// Lazy-loaded to keep the main bundle under the chunk size limit
const KnowledgePage: LazyExoticComponent<() => JSX.Element> = lazy(() =>
  import("./pages/KnowledgePage.js").then((m) => ({ default: m.KnowledgePage })),
);
const SessionsListPage: LazyExoticComponent<() => JSX.Element> = lazy(() =>
  import("./pages/SessionsListPage.js").then((m) => ({ default: m.SessionsListPage })),
);

/** Build-time flag set when producing a static demo build (see vite.config.ts). */
declare const __DEMO_MODE__: boolean;

/** Build-time base URL path for the router (see vite.config.ts). */
declare const __BASE_URL__: string;

/** Whether the app is running in mock mode (`?mock` query parameter or demo build). */
const IS_MOCK_MODE: boolean =
  __DEMO_MODE__ ||
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock"));

/** Inner layout body that conditionally renders the sidebar based on context content. */
function AppShellBody({ tabs }: { tabs: AppTab[] }): JSX.Element {
  const {
    connectionStatus,
    environments: { environments },
    sessions: { sessions },
    tasks: { tasks },
  } = useGrackle();
  const { toasts, dismissToast } = useToast();
  const location = useLocation();
  const sidebarContent = useSidebarContent();
  const hasSidebar = sidebarContent !== undefined;

  // Sidebar drawer state for mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);

  // Auto-close sidebar on navigation (mobile drawer)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

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
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sidebarOpen]);

  return (
    <>
      <StatusBar
        connectionStatus={connectionStatus}
        environments={environments}
        sessions={sessions}
        onToggleSidebar={hasSidebar ? toggleSidebar : undefined}
        sidebarOpen={sidebarOpen}
      />
      <AppNav tabs={tabs} />
      <div className={styles.body}>
        {hasSidebar && (
          <div className={styles.sidebarWrapper} data-sidebar-open={sidebarOpen}>
            <Sidebar content={sidebarContent} />
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
          <BottomStatusBar sessions={sessions} tasks={tasks} environments={environments} />
        </div>
      </div>
      {/* Toast messages (including environment status toasts from
          useEnvironmentToasts) are intentionally generic — no resource names —
          so that getByText() locators in E2E tests remain unique and
          strict-mode safe. Use { exact: true } or data-testid selectors in
          tests when matching resource names that may also appear in transient
          toasts. */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <GlobalShortcuts />
    </>
  );
}

/** Application shell layout with StatusBar, Sidebar, Outlet, and BottomStatusBar. */
function AppShell(): JSX.Element {
  const {
    sessions: { lastSpawnedId },
    environments: {
      environments,
      operationError: environmentOperationError,
      clearOperationError: clearEnvironmentOperationError,
    },
    tasks: { tasks },
    connectionStatus,
    onboardingCompleted,
  } = useGrackle();
  const { pluginNames } = useManifest();
  const { showToast } = useToast();
  useEnvironmentToasts(environments, showToast);
  useTaskToasts(tasks, showToast);
  useEnvironmentOperationToasts(
    environmentOperationError,
    clearEnvironmentOperationError,
    showToast,
  );
  const navigate = useAppNavigate();

  const location = useLocation();

  // Auto-select newly spawned sessions — but only if the user is not
  // already viewing a task (task-spawned sessions should keep the user on
  // the task page rather than redirecting to the raw session view).
  //
  // One-shot per spawn: redirect only when `lastSpawnedId` first changes, not on
  // every later navigation. Otherwise the effect re-fires on each pathname change
  // (lastSpawnedId is never cleared) and bounces the user back to the spawned
  // session whenever they try to leave it — e.g. clicking the Sessions tab.
  const autoSelectedSpawnRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      lastSpawnedId &&
      lastSpawnedId !== autoSelectedSpawnRef.current &&
      !location.pathname.includes("/tasks/")
    ) {
      autoSelectedSpawnRef.current = lastSpawnedId;
      navigate(sessionUrl(lastSpawnedId), { replace: true });
    }
  }, [lastSpawnedId, navigate, location.pathname]);

  // Redirect to setup wizard if onboarding hasn't been completed
  if (connectionStatus === "connected" && onboardingCompleted === false) {
    return <Navigate to="/setup" replace />;
  }

  const tabs = buildTabs(pluginNames);

  return (
    <SidebarProvider>
      <div className={styles.root}>
        {IS_MOCK_MODE && <DemoBanner />}
        <AppShellBody tabs={tabs} />
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
  const {
    workspaces: { workspaces },
  } = useGrackle();
  const location = useLocation();

  const workspace = workspaces.find((w) => w.id === workspaceId);
  const primaryEnvId = workspace?.linkedEnvironmentIds
    ? [...workspace.linkedEnvironmentIds].sort()[0]
    : undefined;
  if (!primaryEnvId) {
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
  const target = `/environments/${encodeURIComponent(primaryEnvId)}/workspaces/${encodedWorkspaceId}${suffix}${location.search}${location.hash}`;
  return <Navigate to={target} replace />;
}

/**
 * Back-compat redirect for legacy `/settings/personas/:personaId` URLs.
 * Re-encodes the `personaId` param via `personaUrl()` so reserved characters
 * survive the redirect (useParams URL-decodes; personaUrl re-encodes).
 */
function PersonaSettingsRedirect(): JSX.Element {
  const { personaId } = useParams<{ personaId: string }>();
  return <Navigate to={personaUrl(personaId ?? "")} replace />;
}

/** Route configuration for the application. */
function AppRoutes(): JSX.Element {
  const { pluginNames } = useManifest();
  const hasOrchestration = pluginNames.includes("orchestration");
  const hasKnowledge = pluginNames.includes("knowledge");

  return (
    <Routes>
      <Route path="setup" element={<SetupWizard />} />
      <Route element={<AppShell />}>
        {/* Pages without sidebar */}
        <Route index element={<EmptyPage />} />
        <Route path="sessions/new" element={<NewChatPage />} />

        {/* Root: the root-task conversation (no sidebar) */}
        <Route path="chat" element={<ChatPage />} />
        {/* Legacy per-stream chat URLs now live on Coordination */}
        <Route path="chat/:streamId" element={<Navigate to="/coordination" replace />} />

        {/* Coordination: read-only IPC stream inventory (no sidebar) */}
        <Route path="coordination" element={<CoordinationPage />} />

        <Route
          path="sessions"
          element={
            <Suspense fallback={<SplashScreen />}>
              <SessionsListPage />
            </Suspense>
          }
        />
        <Route path="sessions/:sessionId" element={<SessionPage />} />

        {/* Knowledge sidebar (knowledge plugin) */}
        {hasKnowledge && (
          <Route element={<WithKnowledgeSidebar />}>
            <Route
              path="knowledge"
              element={
                <Suspense fallback={<SplashScreen />}>
                  <KnowledgePage />
                </Suspense>
              }
            />
          </Route>
        )}

        {/* Tasks sidebar + top-level Persona Library (orchestration plugin) */}
        {hasOrchestration && (
          <>
            <Route element={<WithTaskSidebar />}>
              <Route path="tasks" element={<TasksEmptyPage />} />
              <Route path="tasks/new" element={<NewTaskPage />} />
              <Route path="tasks/:taskId" element={<TaskPage />} />
              <Route path="tasks/:taskId/edit" element={<TaskPage />} />
              <Route path="tasks/:taskId/stream" element={<TaskPage />} />
            </Route>
            {/* Persona Library — top-level surface (no sidebar), like /chat and /coordination */}
            <Route path="personas" element={<PersonaLibraryPage />} />
            <Route path="personas/new" element={<PersonaDetailPage />} />
            <Route path="personas/:personaId" element={<PersonaDetailPage />} />
          </>
        )}

        {/* Environments sidebar */}
        <Route element={<WithEnvironmentSidebar />}>
          <Route path="workspaces" element={<Navigate to="/environments" replace />} />
          <Route path="workspaces/new" element={<WorkspaceCreatePage />} />
          <Route path="workspaces/:workspaceId" element={<WorkspaceRedirect />} />
          <Route path="workspaces/:workspaceId/tasks/:taskId" element={<WorkspaceRedirect />} />
          <Route path="workspaces/:workspaceId/tasks/:taskId/*" element={<WorkspaceRedirect />} />
          <Route
            path="environments/:environmentId/workspaces/:workspaceId"
            element={<WorkspacePage />}
          />
          <Route
            path="environments/:environmentId/workspaces/:workspaceId/tasks/new"
            element={<NewTaskPage />}
          />
          <Route
            path="environments/:environmentId/workspaces/:workspaceId/tasks/:taskId"
            element={<TaskPage />}
          />
          <Route
            path="environments/:environmentId/workspaces/:workspaceId/tasks/:taskId/edit"
            element={<TaskPage />}
          />
          <Route
            path="environments/:environmentId/workspaces/:workspaceId/tasks/:taskId/stream"
            element={<TaskPage />}
          />
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
            <Route path="github-accounts" element={<SettingsGitHubAccountsTab />} />
            <Route path="tokens" element={<Navigate to="../credentials" replace />} />
            <Route path="schedules" element={<SettingsSchedulesTab />} />
            <Route path="schedules/new" element={<ScheduleDetailPage />} />
            <Route path="schedules/:scheduleId" element={<ScheduleDetailPage />} />
            <Route path="appearance" element={<SettingsAppearanceTab />} />
            <Route path="shortcuts" element={<SettingsShortcutsTab />} />
            <Route path="plugins" element={<SettingsPluginsTab />} />
            <Route path="about" element={<SettingsAboutTab />} />
          </Route>
        </Route>

        {/* Back-compat redirects for the legacy /settings/personas* URLs.
            Always on (no plugin gate) so old bookmarks/deep links keep working. */}
        <Route path="settings/personas" element={<Navigate to="/personas" replace />} />
        <Route path="settings/personas/new" element={<Navigate to="/personas/new" replace />} />
        <Route path="settings/personas/:personaId" element={<PersonaSettingsRedirect />} />

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
          {__DEMO_MODE__ ? (
            <HashRouter>
              <AppRoutes />
            </HashRouter>
          ) : (
            <BrowserRouter basename={__BASE_URL__.replace(/\/$/, "")}>
              <AppRoutes />
            </BrowserRouter>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Root application component with context providers and router. */
export default function App(): JSX.Element {
  const Provider = IS_MOCK_MODE ? MockGrackleProvider : GrackleProvider;
  return (
    <ManifestProvider>
      <ThemeProvider>
        <ToastProvider>
          <Provider>
            <AppContent />
          </Provider>
        </ToastProvider>
      </ThemeProvider>
    </ManifestProvider>
  );
}
