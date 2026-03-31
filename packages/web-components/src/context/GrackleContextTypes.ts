/**
 * Type definitions for the GrackleContext value.
 * Kept separate so both the real provider (in @grackle-ai/web) and
 * MockGrackleProvider can use them without circular dependencies.
 *
 * @module
 */

import type {
  UsageStats, UseKnowledgeResult,
  UseEnvironmentsResult, UseSessionsResult, UseWorkspacesResult,
  UseTasksResult, UseFindingsResult, UseTokensResult,
  UseCredentialsResult, UseCodespacesResult, UsePersonasResult,
  UsePluginsResult,
} from "../hooks/types.js";

/** Return type for the useGrackleSocket hook (and the GrackleContext value). */
export interface UseGrackleSocketResult {
  /** Whether the event stream is connected. */
  connected: boolean;
  /** Environment state and actions. */
  environments: Omit<UseEnvironmentsResult, "handleEvent" | "handleLegacyMessage">;
  /** Session state and actions. */
  sessions: Omit<UseSessionsResult, "handleMessage" | "handleSessionEvent" | "handleLegacyMessage" | "loadSessions">;
  /** Workspace state and actions. */
  workspaces: Omit<UseWorkspacesResult, "handleEvent" | "onDisconnect">;
  /** Task state and actions. */
  tasks: Omit<UseTasksResult, "handleEvent" | "onDisconnect" | "handleLegacyMessage">;
  /** Finding state and actions. */
  findings: Omit<UseFindingsResult, "handleEvent">;
  /** Token state and actions. */
  tokens: Omit<UseTokensResult, "handleEvent">;
  /** Credential provider state and actions. */
  credentials: Omit<UseCredentialsResult, "handleEvent" | "loadCredentials">;
  /** GitHub Codespace state and actions. */
  codespaces: UseCodespacesResult;
  /** Persona state and actions. */
  personas: Omit<UsePersonasResult, "handleEvent" | "loadPersonas">;
  /** Knowledge graph state and actions. */
  knowledge: Omit<UseKnowledgeResult, "handleEvent">;
  /** Plugin state and actions. */
  plugins: Omit<UsePluginsResult, "domainHook">;
  /** App-level default persona ID setting. */
  appDefaultPersonaId: string;
  /** Update the app-level default persona ID. */
  setAppDefaultPersonaId: (personaId: string) => Promise<void>;
  /** Whether the user has completed onboarding. */
  onboardingCompleted: boolean | undefined;
  /** Mark onboarding as completed. */
  completeOnboarding: () => Promise<void>;
  /** Cached usage statistics keyed by "scope:id". */
  usageCache: Record<string, UsageStats>;
  /** Load usage statistics for a given scope and ID. */
  loadUsage: (scope: string, id: string) => Promise<void>;
  /** Refresh environments, sessions, workspaces, and tokens from the server. */
  refresh: () => void;
}
