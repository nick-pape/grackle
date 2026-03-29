/**
 * @grackle-ai/web-components — Presentational React component library.
 *
 * @packageDocumentation
 */

// ─── Components ──────────────────────────────────────────────────────────────

// Chat
export { ChatInput } from "./components/chat/index.js";
export type { ChatInputProps } from "./components/chat/index.js";

// DAG visualization
export { DagView } from "./components/dag/DagView.js";
export { TaskNode } from "./components/dag/TaskNode.js";
export { useDagLayout } from "./components/dag/useDagLayout.js";

// Display primitives
export {
  Breadcrumbs, Button, CopyButton, DemoBanner, SplitButton,
  EventRenderer, ConfirmDialog, Spinner, SplashScreen,
} from "./components/display/index.js";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./components/display/index.js";
export { EventStream } from "./components/display/EventStream.js";
export { EventHoverRow } from "./components/display/EventHoverRow.js";
export type { EventHoverRowProps } from "./components/display/EventHoverRow.js";
export { FloatingActionBar } from "./components/display/FloatingActionBar.js";
export type { FloatingActionBarProps } from "./components/display/FloatingActionBar.js";

// Editable fields
export {
  EditableTextField, EditableTextArea, EditableSelect,
  EditableCheckbox, EnvironmentSelect, useEditableField,
} from "./components/editable/index.js";
export type {
  EditableTextFieldProps, EditableTextAreaProps,
  EditableSelectProps, SelectOption,
  EditableCheckboxProps, EnvironmentSelectProps,
  UseEditableFieldOptions, UseEditableFieldReturn,
} from "./components/editable/index.js";

// Knowledge graph
export { KnowledgeGraph, KnowledgeDetailPanel, KnowledgeNav } from "./components/knowledge/index.js";

// Layout
export { StatusBar, AppNav, Sidebar, BottomStatusBar } from "./components/layout/index.js";

// Lists
export { EnvironmentNav, FindingsNav } from "./components/lists/index.js";
export { TaskList } from "./components/lists/TaskList.js";
export { HighlightedText, buildTaskTree, groupTasksByStatus } from "./components/lists/listHelpers.js";

// Notifications
export { Toast, ToastContainer, Callout } from "./components/notifications/index.js";
export type { CalloutVariant } from "./components/notifications/index.js";
export { UpdateBanner } from "./components/notifications/UpdateBanner.js";

// Panels
export { FindingsPanel, TokensPanel, AppearancePanel, AboutPanel, TaskEditPanel } from "./components/panels/index.js";
export { EnvironmentEditPanel } from "./components/panels/EnvironmentEditPanel.js";
export { KeyboardShortcutsPanel } from "./components/panels/KeyboardShortcutsPanel.js";
export { WorkpadPanel } from "./components/panels/WorkpadPanel.js";
export { CredentialProvidersPanel } from "./components/panels/CredentialProvidersPanel.js";

// Personas
export { PersonaManager } from "./components/personas/PersonaManager.js";
export { McpToolSelector } from "./components/personas/McpToolSelector.js";

// Settings
export { SettingsNav } from "./components/settings/SettingsNav.js";

// Tools
export { ToolCard } from "./components/tools/ToolCard.js";
export { FileEditCard } from "./components/tools/FileEditCard.js";
export { FileReadCard } from "./components/tools/FileReadCard.js";
export { ShellCard } from "./components/tools/ShellCard.js";
export { SearchCard } from "./components/tools/SearchCard.js";
export { TodoCard } from "./components/tools/TodoCard.js";
export { MetadataCard } from "./components/tools/MetadataCard.js";
export { GenericToolCard } from "./components/tools/GenericToolCard.js";
export { AgentToolCard } from "./components/tools/AgentToolCard.js";
export { classifyTool } from "./components/tools/classifyTool.js";
export { parseUnifiedDiff, diffFromOldNew, diffStats } from "./components/tools/parseDiff.js";
export type { DiffLine, DiffStats } from "./components/tools/parseDiff.js";
export { parseShellOutput } from "./components/tools/parseShellOutput.js";

// Workspace
export { WorkspaceBoard } from "./components/workspace/WorkspaceBoard.js";
export { WorkspaceFormFields, defaultFormValues } from "./components/workspace/WorkspaceFormFields.js";
export type { WorkspaceFormValues } from "./components/workspace/WorkspaceFormFields.js";

// ─── Contexts ────────────────────────────────────────────────────────────────

export { ToastProvider, useToast } from "./context/ToastContext.js";
export type { ToastItem, ToastVariant } from "./context/ToastContext.js";

export { ThemeProvider, useThemeContext } from "./context/ThemeContext.js";

export { SidebarProvider, useSidebarContent, useSidebarSetter } from "./context/SidebarContext.js";

export { GrackleContext, useGrackle } from "./context/GrackleContext.js";
export type { UseGrackleSocketResult, GrackleContextType } from "./context/GrackleContext.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type {
  Environment, Session, UsageStats, SessionEvent,
  Workspace, TaskData, FindingData, TokenInfo,
  CredentialProviderConfig, Codespace, PersonaData,
  ProvisionStatus, GrackleEvent, WsMessage, SendFunction,
  GraphNode, GraphLink, NodeDetail, UseKnowledgeResult,
} from "./hooks/types.js";
export {
  isObject, warnBadPayload, isGrackleEvent, isSessionEvent,
  isCredentialProviderConfig, parseWsMessage,
  mapSessionStatus, mapEndReason,
  WS_RECONNECT_DELAY_MS, MAX_EVENTS, WS_CLOSE_UNAUTHORIZED,
} from "./hooks/types.js";

// ─── Hooks ───────────────────────────────────────────────────────────────────

export { useSmartScroll } from "./hooks/useSmartScroll.js";
export { useEventSelection } from "./hooks/useEventSelection.js";
export type { UseEventSelectionOptions, UseEventSelectionReturn } from "./hooks/useEventSelection.js";

// ─── Utilities ───────────────────────────────────────────────────────────────

export {
  useAppNavigate, sessionUrl, workspaceUrl, taskUrl, taskEditUrl,
  newTaskUrl, newChatUrl, ENVIRONMENTS_URL, NEW_ENVIRONMENT_URL,
  environmentUrl, environmentEditUrl, SETTINGS_URL,
  SETTINGS_ENVIRONMENTS_URL, SETTINGS_CREDENTIALS_URL,
  PERSONAS_URL, NEW_PERSONA_URL, personaUrl,
  SETTINGS_APPEARANCE_URL, SETTINGS_ABOUT_URL, SETTINGS_SHORTCUTS_URL,
  PAIR_PATH, NEW_WORKSPACE_URL, KNOWLEDGE_URL, HOME_URL,
  FINDINGS_URL, findingsUrl, findingUrl,
} from "./utils/navigation.js";

export {
  TASK_STATUS_STYLES, getStatusStyle, STATUS_BADGE_CLASS_MAP,
  getStatusBadgeClassKey, SIDEBAR_STATUS_ORDER, BOARD_COLUMN_ORDER,
  resolveStatus, STATUS_CSS_VAR_MAP,
} from "./utils/taskStatus.js";
export type { TaskStatusKey, VirtualStatus, DisplayStatus, TaskStatusStyle } from "./utils/taskStatus.js";

export { formatTokens, formatCost } from "./utils/format.js";
export { formatRelativeTime } from "./utils/time.js";
export { CATEGORY_COLORS, getCategoryColor } from "./utils/findingCategory.js";
export type { CategoryColor } from "./utils/findingCategory.js";

export type { BreadcrumbSegment } from "./utils/breadcrumbs.js";
export {
  buildTaskAncestorChain, buildHomeBreadcrumbs, buildSettingsBreadcrumbs,
  buildEnvironmentsBreadcrumbs, buildNewEnvironmentBreadcrumbs,
  buildNewChatBreadcrumbs, buildSessionBreadcrumbs,
  buildWorkspaceBreadcrumbs, buildTaskBreadcrumbs, buildNewTaskBreadcrumbs,
  buildFindingsBreadcrumbs, buildFindingBreadcrumbs,
} from "./utils/breadcrumbs.js";

export { groupConsecutiveTextEvents, pairToolEvents } from "./utils/sessionEvents.js";
export type { DisplayEvent } from "./utils/sessionEvents.js";

export { isContentBearingEvent, getEventCopyText, formatEventsAsMarkdown } from "./utils/eventContent.js";

export type { BoardColumn, BoardTask } from "./utils/boardColumns.js";
export { buildBoardColumns } from "./utils/boardColumns.js";

export type { DashboardKpis, AttentionTask, ActiveSession, WorkspaceSnapshot } from "./utils/dashboard.js";
export { computeKpis, getAttentionTasks, getActiveSessions, getWorkspaceSnapshots } from "./utils/dashboard.js";

export { isNearAnchor, computeScrollCompensation, SCROLL_ANCHOR_THRESHOLD_PX } from "./utils/scrollUtils.js";

// ─── Themes ──────────────────────────────────────────────────────────────────

export { THEMES, THEME_IDS, DEFAULT_THEME_ID, getThemeById } from "./themes.js";
export type { ThemeDefinition } from "./themes.js";

// ─── Mocks & Test Utilities ─────────────────────────────────────────────────

export { MockGrackleProvider } from "./mocks/MockGrackleProvider.js";
export { withMockGrackle, withMockGrackleRoute, makePersona } from "./test-utils/storybook-helpers.js";
