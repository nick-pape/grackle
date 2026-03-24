/**
 * Convert proto-generated types to the existing UI types used by the web hooks.
 *
 * This mapping layer lets us switch hook internals from WebSocket JSON to
 * ConnectRPC without changing any downstream component interfaces.
 *
 * @module
 */

import { grackle } from "@grackle-ai/common";
import {
  eventTypeToString,
  taskStatusToString,
  workspaceStatusToString,
  claudeProviderModeToString,
  providerToggleToString,
} from "@grackle-ai/common";
import type {
  Environment,
  Session,
  SessionEvent,
  Workspace,
  TaskData,
  FindingData,
  TokenInfo,
  CredentialProviderConfig,
  Codespace,
  PersonaData,
  UsageStats,
} from "./types.js";

/** Convert a proto Environment to the UI Environment type. */
export function protoToEnvironment(p: grackle.Environment): Environment {
  return {
    id: p.id,
    displayName: p.displayName,
    adapterType: p.adapterType,
    adapterConfig: p.adapterConfig || "{}",
    status: p.status,
    bootstrapped: p.bootstrapped,
  };
}

/** Convert a proto Session to the UI Session type. */
export function protoToSession(p: grackle.Session): Session {
  return {
    id: p.id,
    environmentId: p.environmentId,
    runtime: p.runtime,
    status: p.status,
    prompt: p.prompt,
    startedAt: p.startedAt,
    endedAt: p.endedAt || undefined,
    error: p.error || undefined,
    endReason: p.endReason || undefined,
    personaId: p.personaId || undefined,
    inputTokens: p.inputTokens,
    outputTokens: p.outputTokens,
    costUsd: p.costUsd,
  };
}

/** Convert a proto SessionEvent to the UI SessionEvent type. */
export function protoToSessionEvent(p: grackle.SessionEvent): SessionEvent {
  return {
    sessionId: p.sessionId,
    eventType: eventTypeToString(p.type),
    timestamp: p.timestamp,
    content: p.content,
    raw: p.raw || undefined,
  };
}

/** Convert a proto Workspace to the UI Workspace type. */
export function protoToWorkspace(p: grackle.Workspace): Workspace {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    repoUrl: p.repoUrl,
    environmentId: p.environmentId,
    status: workspaceStatusToString(p.status),
    workingDirectory: p.workingDirectory,
    useWorktrees: p.useWorktrees,
    defaultPersonaId: p.defaultPersonaId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Convert a proto Task to the UI TaskData type. */
export function protoToTask(p: grackle.Task): TaskData {
  return {
    id: p.id,
    workspaceId: p.workspaceId ?? undefined,
    title: p.title,
    description: p.description,
    status: taskStatusToString(p.status),
    branch: p.branch,
    latestSessionId: p.latestSessionId,
    dependsOn: [...p.dependsOn],
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
    startedAt: p.startedAt || undefined,
    completedAt: p.completedAt || undefined,
    parentTaskId: p.parentTaskId,
    depth: p.depth,
    childTaskIds: [...p.childTaskIds],
    canDecompose: p.canDecompose,
    defaultPersonaId: p.defaultPersonaId,
  };
}

/** Convert a proto Finding to the UI FindingData type. */
export function protoToFinding(p: grackle.Finding): FindingData {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    taskId: p.taskId,
    sessionId: p.sessionId,
    category: p.category,
    title: p.title,
    content: p.content,
    tags: [...p.tags],
    createdAt: p.createdAt,
  };
}

/** Convert a proto TokenInfo to the UI TokenInfo type. */
export function protoToToken(p: grackle.TokenInfo): TokenInfo {
  return {
    name: p.name,
    tokenType: p.type,
    envVar: p.envVar,
    filePath: p.filePath,
    expiresAt: p.expiresAt,
  };
}

/** Convert a proto CredentialProviderConfig to the UI type. */
export function protoToCredentialConfig(p: grackle.CredentialProviderConfig): CredentialProviderConfig {
  return {
    claude: claudeProviderModeToString(p.claude) as CredentialProviderConfig["claude"],
    github: providerToggleToString(p.github) as CredentialProviderConfig["github"],
    copilot: providerToggleToString(p.copilot) as CredentialProviderConfig["copilot"],
    codex: providerToggleToString(p.codex) as CredentialProviderConfig["codex"],
    goose: providerToggleToString(p.goose) as CredentialProviderConfig["goose"],
  };
}

/** Convert a proto CodespaceInfo to the UI Codespace type. */
export function protoToCodespace(p: grackle.CodespaceInfo): Codespace {
  return {
    name: p.name,
    repository: p.repository,
    state: p.state,
    gitStatus: p.gitStatus,
  };
}

/** Convert a proto Persona to the UI PersonaData type. */
export function protoToPersona(p: grackle.Persona): PersonaData {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    systemPrompt: p.systemPrompt,
    toolConfig: p.toolConfig ? JSON.stringify({
      allowedTools: [...p.toolConfig.allowedTools],
      disallowedTools: [...p.toolConfig.disallowedTools],
    }) : "{}",
    runtime: p.runtime,
    model: p.model,
    maxTurns: p.maxTurns,
    mcpServers: JSON.stringify(p.mcpServers.map((s) => ({
      name: s.name,
      command: s.command,
      args: [...s.args],
      tools: [...s.tools],
    }))),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    type: p.type || "agent",
    script: p.script,
  };
}

/** Convert a proto UsageStats to the UI UsageStats type. */
export function protoToUsageStats(p: grackle.UsageStats): UsageStats {
  return {
    inputTokens: p.inputTokens,
    outputTokens: p.outputTokens,
    costUsd: p.costUsd,
    sessionCount: p.sessionCount,
  };
}
