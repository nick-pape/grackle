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
  ProjectStatus,
  IssueState,
} from "./gen/grackle/grackle_pb.js";

// ─── EventType ──────────────────────────────────────────────

const eventTypeToEnumMap: Record<string, EventType> = Object.assign(Object.create(null), {
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
  return eventTypeToStringMap[e] ?? "";
}

// ─── TaskStatus ─────────────────────────────────────────────

const taskStatusToEnumMap: Record<string, TaskStatus> = Object.assign(Object.create(null), {
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
  return taskStatusToStringMap[e] ?? "";
}

// ─── ProjectStatus ──────────────────────────────────────────

const projectStatusToEnumMap: Record<string, ProjectStatus> = Object.assign(Object.create(null), {
  "": ProjectStatus.UNSPECIFIED,
  "active": ProjectStatus.ACTIVE,
  "archived": ProjectStatus.ARCHIVED,
});

const projectStatusToStringMap: Record<number, string> = {
  [ProjectStatus.UNSPECIFIED]: "",
  [ProjectStatus.ACTIVE]: "active",
  [ProjectStatus.ARCHIVED]: "archived",
};

/** Convert a string project status to its proto enum value. */
export function projectStatusToEnum(s: string): ProjectStatus {
  return projectStatusToEnumMap[s] ?? ProjectStatus.UNSPECIFIED;
}

/** Convert a proto enum project status to its string value. */
export function projectStatusToString(e: ProjectStatus): string {
  return projectStatusToStringMap[e] ?? "";
}

// ─── IssueState ─────────────────────────────────────────────

const issueStateToEnumMap: Record<string, IssueState> = Object.assign(Object.create(null), {
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
  return issueStateToStringMap[e] ?? "";
}
