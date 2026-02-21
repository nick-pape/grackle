import type { AgentEventType, SessionStatus } from "@grackle/common";

export interface AgentEvent {
  type: AgentEventType;
  timestamp: string;
  content: string;
  raw?: unknown;
}

export interface SpawnOptions {
  sessionId: string;
  prompt: string;
  model: string;
  maxTurns: number;
}

export interface ResumeOptions {
  sessionId: string;
  runtimeSessionId: string;
}

export interface AgentSession {
  id: string;
  runtimeName: string;
  runtimeSessionId: string;
  status: SessionStatus;
  stream(): AsyncIterable<AgentEvent>;
  sendInput(text: string): void;
  kill(): void;
}

export interface AgentRuntime {
  name: string;
  spawn(opts: SpawnOptions): AgentSession;
  resume(opts: ResumeOptions): AgentSession;
}
