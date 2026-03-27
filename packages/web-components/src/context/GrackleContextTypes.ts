/**
 * Type definitions for the GrackleContext value.
 * Kept separate so both the real provider (in @grackle-ai/web) and
 * MockGrackleProvider can use them without circular dependencies.
 *
 * @module
 */

import type {
  Environment, Session, SessionEvent, Workspace, TaskData,
  FindingData, TokenInfo, CredentialProviderConfig, Codespace,
  PersonaData, ProvisionStatus, UsageStats, UseKnowledgeResult,
} from "../hooks/types.js";

/** Return type for the useGrackleSocket hook (and the GrackleContext value). */
export interface UseGrackleSocketResult {
  connected: boolean;
  environments: Environment[];
  sessions: Session[];
  events: SessionEvent[];
  eventsDropped: number;
  lastSpawnedId: string | undefined;
  workspaces: Workspace[];
  tasks: TaskData[];
  findings: FindingData[];
  tokens: TokenInfo[];
  spawn: (environmentId: string, prompt: string, personaId?: string, workingDirectory?: string) => void;
  sendInput: (sessionId: string, text: string) => void;
  kill: (sessionId: string) => void;
  stopGraceful: (sessionId: string) => void;
  refresh: () => void;
  loadSessionEvents: (sessionId: string) => void;
  clearEvents: () => void;
  loadWorkspaces: () => void;
  createWorkspace: (
    name: string, description?: string, repoUrl?: string, environmentId?: string,
    defaultPersonaId?: string, useWorktrees?: boolean, workingDirectory?: string,
    onSuccess?: () => void, onError?: (message: string) => void,
  ) => void;
  archiveWorkspace: (workspaceId: string) => void;
  updateWorkspace: (
    workspaceId: string,
    fields: {
      name?: string; description?: string; repoUrl?: string;
      environmentId?: string; workingDirectory?: string;
      useWorktrees?: boolean; defaultPersonaId?: string;
    },
  ) => void;
  loadTasks: (workspaceId: string) => void;
  loadAllTasks: () => void;
  createTask: (
    workspaceId: string, title: string, description?: string, dependsOn?: string[],
    parentTaskId?: string, defaultPersonaId?: string, canDecompose?: boolean,
    onSuccess?: () => void, onError?: (message: string) => void,
  ) => void;
  startTask: (taskId: string, personaId?: string, environmentId?: string, notes?: string) => void;
  stopTask: (taskId: string) => void;
  completeTask: (taskId: string) => void;
  resumeTask: (taskId: string) => void;
  updateTask: (taskId: string, title: string, description: string, dependsOn: string[], defaultPersonaId?: string) => void;
  deleteTask: (taskId: string) => void;
  loadFindings: (workspaceId: string) => void;
  postFinding: (workspaceId: string, title: string, content: string, category?: string, tags?: string[]) => void;
  loadEnvironments: () => void;
  addEnvironment: (displayName: string, adapterType: string, adapterConfig?: Record<string, unknown>) => void;
  updateEnvironment: (environmentId: string, fields: { displayName?: string; adapterConfig?: Record<string, unknown> }) => void;
  loadTokens: () => void;
  setToken: (name: string, value: string, tokenType: string, envVar: string, filePath: string) => void;
  deleteToken: (name: string) => void;
  credentialProviders: CredentialProviderConfig;
  updateCredentialProviders: (config: CredentialProviderConfig) => void;
  provisionStatus: Record<string, ProvisionStatus>;
  provisionEnvironment: (environmentId: string, force?: boolean) => void;
  stopEnvironment: (environmentId: string) => void;
  removeEnvironment: (environmentId: string) => void;
  codespaces: Codespace[];
  codespaceError: string;
  codespaceListError: string;
  codespaceCreating: boolean;
  listCodespaces: () => void;
  createCodespace: (repo: string, machine?: string) => void;
  workspaceCreating: boolean;
  taskStartingId: string | undefined;
  personas: PersonaData[];
  createPersona: (
    name: string, description: string, systemPrompt: string, runtime?: string,
    model?: string, maxTurns?: number, type?: string, script?: string,
  ) => Promise<PersonaData>;
  updatePersona: (
    personaId: string, name?: string, description?: string, systemPrompt?: string,
    runtime?: string, model?: string, maxTurns?: number, type?: string, script?: string,
  ) => Promise<PersonaData>;
  deletePersona: (personaId: string) => Promise<void>;
  taskSessions: Record<string, Session[]>;
  loadTaskSessions: (taskId: string) => void;
  appDefaultPersonaId: string;
  setAppDefaultPersonaId: (personaId: string) => Promise<void>;
  onboardingCompleted: boolean | undefined;
  completeOnboarding: () => void;
  usageCache: Record<string, UsageStats>;
  loadUsage: (scope: string, id: string) => void;
  knowledge: UseKnowledgeResult;
}
