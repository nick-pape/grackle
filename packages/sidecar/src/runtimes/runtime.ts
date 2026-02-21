import type { AgentEventType, SessionStatus } from "@grackle/common";

export interface AgentEvent {
  type: AgentEventType;
  timestamp: string;
  content: string;
  raw?: unknown;
}

export interface SpawnOpts {
  sessionId: string;
  prompt: string;
  model: string;
  maxTurns: number;
}

export interface ResumeOpts {
  sessionId: string;
  runtimeSessionId: string;
}

export interface AgentSession {
  id: string;
  runtimeSessionId: string;
  status: SessionStatus;
  stream(): AsyncIterable<AgentEvent>;
  sendInput(text: string): void;
  kill(): void;
}

export interface AgentRuntime {
  name: string;
  spawn(opts: SpawnOpts): AgentSession;
  resume(opts: ResumeOpts): AgentSession;
}
