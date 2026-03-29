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
  selectedFinding: FindingData | undefined;
  findingLoading: boolean;
  tokens: TokenInfo[];
  spawn: (environmentId: string, prompt: string, personaId?: string, workingDirectory?: string) => Promise<void>;
  sendInput: (sessionId: string, text: string) => Promise<void>;
  kill: (sessionId: string) => Promise<void>;
  stopGraceful: (sessionId: string) => Promise<void>;
  refresh: () => void;
  loadSessionEvents: (sessionId: string) => Promise<void>;
  clearEvents: () => void;
  loadWorkspaces: () => Promise<void>;
  createWorkspace: (
    name: string, description?: string, repoUrl?: string, environmentId?: string,
    defaultPersonaId?: string, useWorktrees?: boolean, workingDirectory?: string,
    onSuccess?: () => void, onError?: (message: string) => void,
  ) => Promise<void>;
  archiveWorkspace: (workspaceId: string) => Promise<void>;
  updateWorkspace: (
    workspaceId: string,
    fields: {
      name?: string; description?: string; repoUrl?: string;
      environmentId?: string; workingDirectory?: string;
      useWorktrees?: boolean; defaultPersonaId?: string;
    },
  ) => Promise<void>;
  loadTasks: (workspaceId: string) => Promise<void>;
  loadAllTasks: () => Promise<void>;
  createTask: (
    workspaceId: string, title: string, description?: string, dependsOn?: string[],
    parentTaskId?: string, defaultPersonaId?: string, canDecompose?: boolean,
    onSuccess?: () => void, onError?: (message: string) => void,
  ) => Promise<void>;
  startTask: (taskId: string, personaId?: string, environmentId?: string, notes?: string) => Promise<void>;
  stopTask: (taskId: string) => Promise<void>;
  completeTask: (taskId: string) => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
  updateTask: (taskId: string, title: string, description: string, dependsOn: string[], defaultPersonaId?: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  loadFindings: (workspaceId: string) => Promise<void>;
  loadAllFindings: () => Promise<void>;
  loadFinding: (findingId: string) => Promise<void>;
  postFinding: (workspaceId: string, title: string, content: string, category?: string, tags?: string[]) => Promise<void>;
  loadEnvironments: () => Promise<void>;
  addEnvironment: (displayName: string, adapterType: string, adapterConfig?: Record<string, unknown>) => Promise<void>;
  updateEnvironment: (environmentId: string, fields: { displayName?: string; adapterConfig?: Record<string, unknown> }) => Promise<void>;
  loadTokens: () => Promise<void>;
  setToken: (name: string, value: string, tokenType: string, envVar: string, filePath: string) => Promise<void>;
  deleteToken: (name: string) => Promise<void>;
  credentialProviders: CredentialProviderConfig;
  updateCredentialProviders: (config: CredentialProviderConfig) => Promise<void>;
  provisionStatus: Record<string, ProvisionStatus>;
  environmentOperationError: string;
  clearEnvironmentOperationError: () => void;
  provisionEnvironment: (environmentId: string, force?: boolean) => Promise<void>;
  stopEnvironment: (environmentId: string) => Promise<void>;
  removeEnvironment: (environmentId: string) => Promise<void>;
  codespaces: Codespace[];
  codespaceError: string;
  codespaceListError: string;
  codespaceCreating: boolean;
  listCodespaces: () => Promise<void>;
  createCodespace: (repo: string, machine?: string) => Promise<void>;
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
  loadTaskSessions: (taskId: string) => Promise<void>;
  appDefaultPersonaId: string;
  setAppDefaultPersonaId: (personaId: string) => Promise<void>;
  onboardingCompleted: boolean | undefined;
  completeOnboarding: () => Promise<void>;
  usageCache: Record<string, UsageStats>;
  loadUsage: (scope: string, id: string) => Promise<void>;
  knowledge: UseKnowledgeResult;
}
