/**
 * Bidirectional converters between string values (used in SQLite/WS) and
 * protobuf enum values (used in gRPC messages).
 */
import {
  EnvironmentStatus,
  SessionStatus,
  EventType,
  TaskStatus,
  ProjectStatus,
  TokenType,
} from "./gen/grackle/grackle_pb.js";
import { AgentEventType } from "./gen/grackle/powerline/powerline_pb.js";

// ─── EnvironmentStatus ──────────────────────────────────────

const environmentStatusToEnumMap: Record<string, EnvironmentStatus> = {
  "": EnvironmentStatus.UNSPECIFIED,
  "disconnected": EnvironmentStatus.DISCONNECTED,
  "connecting": EnvironmentStatus.CONNECTING,
  "connected": EnvironmentStatus.CONNECTED,
  "sleeping": EnvironmentStatus.SLEEPING,
  "error": EnvironmentStatus.ERROR,
};

const environmentStatusToStringMap: Record<number, string> = {
  [EnvironmentStatus.UNSPECIFIED]: "",
  [EnvironmentStatus.DISCONNECTED]: "disconnected",
  [EnvironmentStatus.CONNECTING]: "connecting",
  [EnvironmentStatus.CONNECTED]: "connected",
  [EnvironmentStatus.SLEEPING]: "sleeping",
  [EnvironmentStatus.ERROR]: "error",
};

/** Convert a string environment status to its proto enum value. */
export function environmentStatusToEnum(s: string): EnvironmentStatus {
  return environmentStatusToEnumMap[s] ?? EnvironmentStatus.UNSPECIFIED;
}

/** Convert a proto enum environment status to its string value. */
export function environmentStatusToString(e: EnvironmentStatus): string {
  return environmentStatusToStringMap[e] ?? "";
}

// ─── SessionStatus ──────────────────────────────────────────

const sessionStatusToEnumMap: Record<string, SessionStatus> = {
  "": SessionStatus.UNSPECIFIED,
  "pending": SessionStatus.PENDING,
  "running": SessionStatus.RUNNING,
  "waiting_input": SessionStatus.WAITING_INPUT,
  "suspended": SessionStatus.SUSPENDED,
  "completed": SessionStatus.COMPLETED,
  "failed": SessionStatus.FAILED,
  "killed": SessionStatus.KILLED,
};

const sessionStatusToStringMap: Record<number, string> = {
  [SessionStatus.UNSPECIFIED]: "",
  [SessionStatus.PENDING]: "pending",
  [SessionStatus.RUNNING]: "running",
  [SessionStatus.WAITING_INPUT]: "waiting_input",
  [SessionStatus.SUSPENDED]: "suspended",
  [SessionStatus.COMPLETED]: "completed",
  [SessionStatus.FAILED]: "failed",
  [SessionStatus.KILLED]: "killed",
};

/** Convert a string session status to its proto enum value. */
export function sessionStatusToEnum(s: string): SessionStatus {
  return sessionStatusToEnumMap[s] ?? SessionStatus.UNSPECIFIED;
}

/** Convert a proto enum session status to its string value. */
export function sessionStatusToString(e: SessionStatus): string {
  return sessionStatusToStringMap[e] ?? "";
}

// ─── EventType ──────────────────────────────────────────────

const eventTypeToEnumMap: Record<string, EventType> = {
  "": EventType.UNSPECIFIED,
  "text": EventType.TEXT,
  "tool_use": EventType.TOOL_USE,
  "tool_result": EventType.TOOL_RESULT,
  "error": EventType.ERROR,
  "status": EventType.STATUS,
  "system": EventType.SYSTEM,
  "finding": EventType.FINDING,
};

const eventTypeToStringMap: Record<number, string> = {
  [EventType.UNSPECIFIED]: "",
  [EventType.TEXT]: "text",
  [EventType.TOOL_USE]: "tool_use",
  [EventType.TOOL_RESULT]: "tool_result",
  [EventType.ERROR]: "error",
  [EventType.STATUS]: "status",
  [EventType.SYSTEM]: "system",
  [EventType.FINDING]: "finding",
};

/** Convert a string event type to its proto enum value. */
export function eventTypeToEnum(s: string): EventType {
  return eventTypeToEnumMap[s] ?? EventType.UNSPECIFIED;
}

/** Convert a proto enum event type to its string value. */
export function eventTypeToString(e: EventType): string {
  return eventTypeToStringMap[e] ?? "";
}

// ─── AgentEventType ─────────────────────────────────────────

const agentEventTypeToEnumMap: Record<string, AgentEventType> = {
  "": AgentEventType.UNSPECIFIED,
  "text": AgentEventType.TEXT,
  "tool_use": AgentEventType.TOOL_USE,
  "tool_result": AgentEventType.TOOL_RESULT,
  "error": AgentEventType.ERROR,
  "status": AgentEventType.STATUS,
  "system": AgentEventType.SYSTEM,
  "finding": AgentEventType.FINDING,
};

const agentEventTypeToStringMap: Record<number, string> = {
  [AgentEventType.UNSPECIFIED]: "",
  [AgentEventType.TEXT]: "text",
  [AgentEventType.TOOL_USE]: "tool_use",
  [AgentEventType.TOOL_RESULT]: "tool_result",
  [AgentEventType.ERROR]: "error",
  [AgentEventType.STATUS]: "status",
  [AgentEventType.SYSTEM]: "system",
  [AgentEventType.FINDING]: "finding",
};

/** Convert a string agent event type to its proto enum value. */
export function agentEventTypeToEnum(s: string): AgentEventType {
  return agentEventTypeToEnumMap[s] ?? AgentEventType.UNSPECIFIED;
}

/** Convert a proto enum agent event type to its string value. */
export function agentEventTypeToString(e: AgentEventType): string {
  return agentEventTypeToStringMap[e] ?? "";
}

/** Convert a PowerLine AgentEventType to a Grackle EventType via string mapping. */
export function agentEventTypeToEventType(agentType: AgentEventType): EventType {
  return eventTypeToEnum(agentEventTypeToString(agentType));
}

// ─── TokenType ──────────────────────────────────────────────

const tokenTypeToEnumMap: Record<string, TokenType> = {
  "": TokenType.UNSPECIFIED,
  "env_var": TokenType.ENV_VAR,
  "file": TokenType.FILE,
};

const tokenTypeToStringMap: Record<number, string> = {
  [TokenType.UNSPECIFIED]: "",
  [TokenType.ENV_VAR]: "env_var",
  [TokenType.FILE]: "file",
};

/** Convert a string token type to its proto enum value. */
export function tokenTypeToEnum(s: string): TokenType {
  return tokenTypeToEnumMap[s] ?? TokenType.UNSPECIFIED;
}

/** Convert a proto enum token type to its string value. */
export function tokenTypeToString(e: TokenType): string {
  return tokenTypeToStringMap[e] ?? "";
}

// ─── TaskStatus ─────────────────────────────────────────────

const taskStatusToEnumMap: Record<string, TaskStatus> = {
  "": TaskStatus.UNSPECIFIED,
  "pending": TaskStatus.PENDING,
  "assigned": TaskStatus.ASSIGNED,
  "in_progress": TaskStatus.IN_PROGRESS,
  "review": TaskStatus.REVIEW,
  "done": TaskStatus.DONE,
  "failed": TaskStatus.FAILED,
};

const taskStatusToStringMap: Record<number, string> = {
  [TaskStatus.UNSPECIFIED]: "",
  [TaskStatus.PENDING]: "pending",
  [TaskStatus.ASSIGNED]: "assigned",
  [TaskStatus.IN_PROGRESS]: "in_progress",
  [TaskStatus.REVIEW]: "review",
  [TaskStatus.DONE]: "done",
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

const projectStatusToEnumMap: Record<string, ProjectStatus> = {
  "": ProjectStatus.UNSPECIFIED,
  "active": ProjectStatus.ACTIVE,
  "archived": ProjectStatus.ARCHIVED,
};

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
