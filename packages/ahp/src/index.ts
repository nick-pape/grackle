/**
 * Agent Host Protocol (AHP) — type definitions and reducers.
 *
 * Vendored from Microsoft's open-source [Agent Host Protocol](https://github.com/microsoft/agent-host-protocol)
 * and built via a prebuild transform step.
 *
 * The vendored source lives under `src/vendor/ahp/`. This file re-exports the
 * canonical shapes and the pure reducer functions that fold AHP actions into
 * derived state.
 *
 * @module agent-host-protocol
 */

// ─── State types ───────────────────────────────────────────────

export type {
  URI,
  StringOrMarkdown,
  Icon,
  RootState,
  RootConfigState,
  AgentInfo,
  ProtectedResourceMetadata,
  ProjectInfo,
  SessionModelInfo,
  ModelSelection,
  AgentSelection,
  SessionState,
  SessionSummary,
  SessionConfigState,
  SessionConfigPropertySchema,
  SessionConfigSchema,
  SessionInputOption,
  SessionInputTextQuestion,
  SessionInputNumberQuestion,
  SessionInputBooleanQuestion,
  SessionInputSingleSelectQuestion,
  SessionInputMultiSelectQuestion,
  Message,
  MessageAttachment,
  MessageAttachmentBase,
  ResponsePart,
  ToolCallResponsePart,
  ToolCallState,
  ToolCallResult,
  ToolResultContent,
  ToolDefinition,
  ToolAnnotations,
  SessionActiveClient,
  Customization,
  PluginCustomization,
  DirectoryCustomization,
  ClientPluginCustomization,
  ChildCustomization,
  AgentCustomization,
  SkillCustomization,
  PromptCustomization,
  RuleCustomization,
  HookCustomization,
  McpServerCustomization,
  CustomizationLoadState,
  SessionInputRequest,
  SessionInputAnswer,
  SessionInputAnswerValue,
  SessionInputQuestion,
  SessionInputAnswered,
  SessionInputSkipped,
  SessionInputTextAnswerValue,
  SessionInputNumberAnswerValue,
  SessionInputBooleanAnswerValue,
  SessionInputSelectedAnswerValue,
  SessionInputSelectedManyAnswerValue,
  PendingMessage,
  Snapshot,
  TerminalState,
  TerminalContentPart,
  TerminalUnclassifiedPart,
  TerminalCommandPart,
  ChangesetState,
  ChangesetSummary,
  ConfigPropertySchema,
  ConfigSchema,
  TextPosition,
  TextRange,
  TextSelection,
  ContentRef,
  FileEdit,
  UsageInfo,
  ErrorInfo,
  TelemetryCapabilities,
  ResourceWatchState,
  ResourceChange,
} from "./vendor/ahp/state.js";

// ─── Enum values (runtime constants) ───────────────────────────

export {
  PolicyState,
  SessionLifecycle,
  SessionStatus,
  PendingMessageKind,
  SessionInputResponseKind,
  SessionInputQuestionKind,
  SessionInputAnswerState,
  SessionInputAnswerValueKind,
  TurnState,
  MessageAttachmentKind,
  ResponsePartKind,
  ToolCallStatus,
  ToolCallConfirmationReason,
  ToolCallCancellationReason,
  ConfirmationOptionKind,
  ToolResultContentType,
  MessageKind,
  CustomizationType,
  CustomizationLoadStatus,
  TerminalClaimKind,
  ChangesetStatus,
  ChangesetOperationScope,
  ResourceChangeType,
} from "./vendor/ahp/state.js";

// ─── Action types ───────────────────────────────────────────────

export type {
  ActionEnvelope,
  ActionOrigin,
  StateAction,
  // Root actions
  RootAgentsChangedAction,
  RootActiveSessionsChangedAction,
  RootTerminalsChangedAction,
  RootConfigChangedAction,
  // Session actions
  SessionReadyAction,
  SessionCreationFailedAction,
  SessionTurnStartedAction,
  SessionDeltaAction,
  SessionResponsePartAction,
  SessionToolCallStartAction,
  SessionToolCallDeltaAction,
  SessionToolCallReadyAction,
  SessionToolCallApprovedAction,
  SessionToolCallDeniedAction,
  SessionToolCallCompleteAction,
  SessionToolCallResultConfirmedAction,
  SessionToolCallContentChangedAction,
  SessionTurnCompleteAction,
  SessionTurnCancelledAction,
  SessionErrorAction,
  SessionTitleChangedAction,
  SessionUsageAction,
  SessionReasoningAction,
  SessionModelChangedAction,
  SessionAgentChangedAction,
  SessionServerToolsChangedAction,
  SessionActiveClientChangedAction,
  SessionActiveClientToolsChangedAction,
  SessionPendingMessageSetAction,
  SessionPendingMessageRemovedAction,
  SessionQueuedMessagesReorderedAction,
  SessionInputRequestedAction,
  SessionInputAnswerChangedAction,
  SessionInputCompletedAction,
  SessionCustomizationsChangedAction,
  SessionCustomizationToggledAction,
  SessionCustomizationUpdatedAction,
  SessionCustomizationRemovedAction,
  SessionTruncatedAction,
  SessionIsReadChangedAction,
  SessionIsArchivedChangedAction,
  SessionActivityChangedAction,
  SessionChangesetsChangedAction,
  SessionConfigChangedAction,
  SessionMetaChangedAction,
  // Terminal actions
  TerminalDataAction,
  TerminalInputAction,
  TerminalResizedAction,
  TerminalClaimedAction,
  TerminalTitleChangedAction,
  TerminalCwdChangedAction,
  TerminalExitedAction,
  TerminalClearedAction,
  TerminalCommandDetectionAvailableAction,
  TerminalCommandExecutedAction,
  TerminalCommandFinishedAction,
  // Changeset actions
  ChangesetStatusChangedAction,
  ChangesetFileSetAction,
  ChangesetFileRemovedAction,
  ChangesetOperationsChangedAction,
  ChangesetClearedAction,
  // Resource-watch actions
  ResourceWatchChangedAction,
} from "./vendor/ahp/actions.js";

// ─── Action enum values (runtime constant) ──────────────────────

export { ActionType } from "./vendor/ahp/actions.js";

// ─── Command types ──────────────────────────────────────────────

export type {
  BaseParams,
  InitializeParams,
  InitializeResult,
  PingParams,
  ReconnectParams,
  ReconnectResult,
  SubscribeParams,
  SubscribeResult,
  UnsubscribeParams,
  DispatchActionParams,
  ResourceReadParams,
  ResourceReadResult,
  ResourceWriteParams,
  ResourceWriteResult,
  ResourceListParams,
  DirectoryEntry,
  ResourceListResult,
  ResourceCopyParams,
  ResourceCopyResult,
  ResourceDeleteParams,
  ResourceDeleteResult,
  ResourceRequestParams,
  ResourceRequestResult,
  ResourceMoveParams,
  ResourceMoveResult,
  ResourceResolveParams,
  ResourceResolveResult,
  ResourceMkdirParams,
  ResourceMkdirResult,
  CreateResourceWatchParams,
  CreateResourceWatchResult,
  AuthenticateParams,
  AuthenticateResult,
  ListSessionsParams,
  ListSessionsResult,
  ResolveSessionConfigParams,
  ResolveSessionConfigResult,
  SessionConfigValueItem,
  SessionConfigCompletionsParams,
  SessionConfigCompletionsResult,
  CreateSessionParams,
  SessionForkSource,
  DisposeSessionParams,
  FetchTurnsParams,
  FetchTurnsResult,
  CompletionsParams,
  CompletionItem,
  CompletionsResult,
  CreateTerminalParams,
  DisposeTerminalParams,
  InvokeChangesetOperationParams,
  ChangesetOperationTarget,
  ChangesetOperationFollowUp,
} from "./vendor/ahp/commands.js";

// ─── Command enum values ────────────────────────────────────────

export {
  ReconnectResultType,
  ContentEncoding,
  ResourceWriteMode,
  ResourceType,
  CompletionItemKind,
  ChangesetOperationTargetKind,
} from "./vendor/ahp/commands.js";

// ─── Notification types ─────────────────────────────────────────

export type {
  AuthRequiredParams,
  SessionAddedParams,
  SessionRemovedParams,
  SessionSummaryChangedParams,
  OtlpExportLogsParams,
  OtlpExportTracesParams,
  OtlpExportMetricsParams,
} from "./vendor/ahp/notifications.js";

// ─── Notification enum values ───────────────────────────────────

export { AuthRequiredReason } from "./vendor/ahp/notifications.js";

// ─── Message types ──────────────────────────────────────────────

export type {
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  AhpErrorResponse,
  CommandMap,
  ServerCommandMap,
  ClientNotificationMap,
  ServerNotificationMap,
  JsonRpcResponse,
  AhpRequest,
  AhpServerRequest,
  AhpSuccessResponse,
  AhpResponse,
  AhpServerSuccessResponse,
  AhpServerResponse,
  AhpClientNotification,
  AhpServerNotification,
  AhpNotification,
  ProtocolMessage,
} from "./vendor/ahp/messages.js";

// ─── Error codes ────────────────────────────────────────────────

export { JsonRpcErrorCodes, AhpErrorCodes } from "./vendor/ahp/common/errors.js";
export type {
  JsonRpcErrorCode,
  AhpErrorCode,
  AuthRequiredErrorData,
  PermissionDeniedErrorData,
  UnsupportedProtocolVersionErrorData,
} from "./vendor/ahp/common/errors.js";

// ─── Reducer functions ──────────────────────────────────────────

export {
  rootReducer,
  sessionReducer,
  terminalReducer,
  changesetReducer,
  resourceWatchReducer,
  softAssertNever,
  isClientDispatchable,
} from "./vendor/ahp/reducers.js";
