/**
 * Bidirectional converters between string values (used in SQLite/WS) and
 * protobuf enum values (used in gRPC messages).
 *
 * String-keyed maps use null-prototype objects to prevent prototype pollution
 * when indexing with untrusted strings (CLI flags, WS payloads, DB contents).
 */
import {
  EventType,
  TaskStatus,
  WorkspaceStatus,
  IssueState,
  ClaudeProviderMode,
  ProviderToggle,
} from "./gen/grackle/grackle_pb.js";

// ─── EventType ──────────────────────────────────────────────

const eventTypeToEnumMap: Record<string, EventType> = Object.assign(Object.create(null) as Record<string, EventType>, {
  "": EventType.UNSPECIFIED,
  "text": EventType.TEXT,
  "tool_use": EventType.TOOL_USE,
  "tool_result": EventType.TOOL_RESULT,
  "error": EventType.ERROR,
  "status": EventType.STATUS,
  "system": EventType.SYSTEM,
  "finding": EventType.FINDING,
  "subtask_create": EventType.SUBTASK_CREATE,
  "user_input": EventType.USER_INPUT,
});

const eventTypeToStringMap: Record<number, string> = {
  [EventType.UNSPECIFIED]: "",
  [EventType.TEXT]: "text",
  [EventType.TOOL_USE]: "tool_use",
  [EventType.TOOL_RESULT]: "tool_result",
  [EventType.ERROR]: "error",
  [EventType.STATUS]: "status",
  [EventType.SYSTEM]: "system",
  [EventType.FINDING]: "finding",
  [EventType.SUBTASK_CREATE]: "subtask_create",
  [EventType.USER_INPUT]: "user_input",
};

/** Convert a string event type to its proto enum value. */
export function eventTypeToEnum(s: string): EventType {
  return eventTypeToEnumMap[s] ?? EventType.UNSPECIFIED;
}

/** Convert a proto enum event type to its string value. */
export function eventTypeToString(e: EventType): string {
  return (eventTypeToStringMap as Partial<Record<number, string>>)[e] ?? "";
}

// ─── TaskStatus ─────────────────────────────────────────────

const taskStatusToEnumMap: Record<string, TaskStatus> = Object.assign(Object.create(null) as Record<string, TaskStatus>, {
  "": TaskStatus.UNSPECIFIED,
  // Canonical mappings
  "not_started": TaskStatus.NOT_STARTED,
  "working": TaskStatus.WORKING,
  "paused": TaskStatus.PAUSED,
  "complete": TaskStatus.COMPLETE,
  "failed": TaskStatus.FAILED,
  // Backwards-compatible read mappings (old DB strings → new enums)
  "pending": TaskStatus.NOT_STARTED,
  "assigned": TaskStatus.NOT_STARTED,
  "in_progress": TaskStatus.WORKING,
  "waiting_input": TaskStatus.PAUSED,
  "review": TaskStatus.PAUSED,
  "done": TaskStatus.COMPLETE,
});

const taskStatusToStringMap: Record<number, string> = {
  [TaskStatus.UNSPECIFIED]: "",
  [TaskStatus.NOT_STARTED]: "not_started",
  [TaskStatus.WORKING]: "working",
  [TaskStatus.PAUSED]: "paused",
  [TaskStatus.COMPLETE]: "complete",
  [TaskStatus.FAILED]: "failed",
};

/** Convert a string task status to its proto enum value. */
export function taskStatusToEnum(s: string): TaskStatus {
  return taskStatusToEnumMap[s] ?? TaskStatus.UNSPECIFIED;
}

/** Convert a proto enum task status to its string value. */
export function taskStatusToString(e: TaskStatus): string {
  return (taskStatusToStringMap as Partial<Record<number, string>>)[e] ?? "";
}

// ─── WorkspaceStatus ────────────────────────────────────────

const workspaceStatusToEnumMap: Record<string, WorkspaceStatus> = Object.assign(Object.create(null) as Record<string, WorkspaceStatus>, {
  "": WorkspaceStatus.UNSPECIFIED,
  "active": WorkspaceStatus.ACTIVE,
  "archived": WorkspaceStatus.ARCHIVED,
});

const workspaceStatusToStringMap: Record<number, string> = {
  [WorkspaceStatus.UNSPECIFIED]: "",
  [WorkspaceStatus.ACTIVE]: "active",
  [WorkspaceStatus.ARCHIVED]: "archived",
};

/** Convert a string workspace status to its proto enum value. */
export function workspaceStatusToEnum(s: string): WorkspaceStatus {
  return workspaceStatusToEnumMap[s] ?? WorkspaceStatus.UNSPECIFIED;
}

/** Convert a proto enum workspace status to its string value. */
export function workspaceStatusToString(e: WorkspaceStatus): string {
  return (workspaceStatusToStringMap as Partial<Record<number, string>>)[e] ?? "";
}

// ─── IssueState ─────────────────────────────────────────────

const issueStateToEnumMap: Record<string, IssueState> = Object.assign(Object.create(null) as Record<string, IssueState>, {
  "": IssueState.UNSPECIFIED,
  "open": IssueState.OPEN,
  "closed": IssueState.CLOSED,
});

const issueStateToStringMap: Record<number, string> = {
  [IssueState.UNSPECIFIED]: "",
  [IssueState.OPEN]: "open",
  [IssueState.CLOSED]: "closed",
};

/** Convert a string issue state to its proto enum value. */
export function issueStateToEnum(s: string): IssueState {
  return issueStateToEnumMap[s] ?? IssueState.UNSPECIFIED;
}

/** Convert a proto enum issue state to its string value. */
export function issueStateToString(e: IssueState): string {
  return (issueStateToStringMap as Partial<Record<number, string>>)[e] ?? "";
}

// ─── ClaudeProviderMode ─────────────────────────────────────

const claudeProviderModeToEnumMap: Record<string, ClaudeProviderMode> = Object.assign(Object.create(null) as Record<string, ClaudeProviderMode>, {
  "": ClaudeProviderMode.UNSPECIFIED,
  "off": ClaudeProviderMode.OFF,
  "subscription": ClaudeProviderMode.SUBSCRIPTION,
  "api_key": ClaudeProviderMode.API_KEY,
});

const claudeProviderModeToStringMap: Record<number, string> = {
  [ClaudeProviderMode.UNSPECIFIED]: "",
  [ClaudeProviderMode.OFF]: "off",
  [ClaudeProviderMode.SUBSCRIPTION]: "subscription",
  [ClaudeProviderMode.API_KEY]: "api_key",
};

/** Convert a string Claude provider mode to its proto enum value. */
export function claudeProviderModeToEnum(s: string): ClaudeProviderMode {
  return claudeProviderModeToEnumMap[s] ?? ClaudeProviderMode.UNSPECIFIED;
}

/** Convert a proto enum Claude provider mode to its string value. */
export function claudeProviderModeToString(e: ClaudeProviderMode): string {
  return (claudeProviderModeToStringMap as Partial<Record<number, string>>)[e] ?? "";
}

// ─── ProviderToggle ─────────────────────────────────────────

const providerToggleToEnumMap: Record<string, ProviderToggle> = Object.assign(Object.create(null) as Record<string, ProviderToggle>, {
  "": ProviderToggle.UNSPECIFIED,
  "off": ProviderToggle.OFF,
  "on": ProviderToggle.ON,
});

const providerToggleToStringMap: Record<number, string> = {
  [ProviderToggle.UNSPECIFIED]: "",
  [ProviderToggle.OFF]: "off",
  [ProviderToggle.ON]: "on",
};

/** Convert a string provider toggle to its proto enum value. */
export function providerToggleToEnum(s: string): ProviderToggle {
  return providerToggleToEnumMap[s] ?? ProviderToggle.UNSPECIFIED;
}

/** Convert a proto enum provider toggle to its string value. */
export function providerToggleToString(e: ProviderToggle): string {
  return (providerToggleToStringMap as Partial<Record<number, string>>)[e] ?? "";
}
