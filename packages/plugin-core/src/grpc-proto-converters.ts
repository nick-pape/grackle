import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import {
  workspaceStatusToEnum,
  taskStatusToEnum,
} from "@grackle-ai/common";
import type { EnvironmentRow, SessionRow } from "@grackle-ai/database";
import { workspaceStore, taskStore, personaStore, findingStore, escalationStore, workspaceEnvironmentLinkStore, safeParseJsonArray } from "@grackle-ai/database";
import type { KnowledgeNode, KnowledgeEdge } from "@grackle-ai/knowledge";

/** Convert an environment database row to its proto representation. */
export function envRowToProto(row: EnvironmentRow): grackle.Environment {
  return create(grackle.EnvironmentSchema, {
    id: row.id,
    displayName: row.displayName,
    adapterType: row.adapterType,
    adapterConfig: row.adapterConfig,
    bootstrapped: row.bootstrapped,
    status: row.status,
    lastSeen: row.lastSeen || "",
    envInfo: row.envInfo || "",
    createdAt: row.createdAt,
  });
}

/** Convert a session database row to its proto representation. */
export function sessionRowToProto(row: SessionRow): grackle.Session {
  return create(grackle.SessionSchema, {
    id: row.id,
    environmentId: row.environmentId,
    runtime: row.runtime,
    runtimeSessionId: row.runtimeSessionId ?? "",
    prompt: row.prompt,
    model: row.model,
    status: row.status,
    logPath: row.logPath ?? "",
    turns: row.turns,
    startedAt: row.startedAt,
    suspendedAt: row.suspendedAt ?? "",
    endedAt: row.endedAt ?? "",
    error: row.error ?? "",
    taskId: row.taskId,
    personaId: row.personaId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costMillicents: row.costMillicents,
    endReason: row.endReason ?? "",
  });
}

/**
 * Convert a workspace database row to its proto representation.
 * When converting many workspaces (e.g. listWorkspaces), pass a pre-fetched
 * linkedEnvMap to avoid N+1 queries. When omitted, falls back to a per-row query.
 */
export function workspaceRowToProto(
  row: workspaceStore.WorkspaceRow,
  linkedEnvMap?: Map<string, string[]>,
): grackle.Workspace {
  const linkedIds = linkedEnvMap
    ? (linkedEnvMap.get(row.id) ?? [])
    : workspaceEnvironmentLinkStore.getLinkedEnvironmentIds(row.id);
  return create(grackle.WorkspaceSchema, {
    id: row.id,
    name: row.name,
    description: row.description,
    repoUrl: row.repoUrl,
    environmentId: row.environmentId,
    status: workspaceStatusToEnum(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    useWorktrees: row.useWorktrees,
    workingDirectory: row.workingDirectory,
    defaultPersonaId: row.defaultPersonaId,
    linkedEnvironmentIds: linkedIds,
    tokenBudget: row.tokenBudget,
    costBudgetMillicents: row.costBudgetMillicents,
  });
}

/** Convert a task database row to its proto representation. */
export function taskRowToProto(
  row: taskStore.TaskRow,
  childIds?: string[],
  computedStatus?: string,
  latestSessionId?: string,
): grackle.Task {
  return create(grackle.TaskSchema, {
    id: row.id,
    workspaceId: row.workspaceId ?? undefined,
    title: row.title,
    description: row.description,
    status: taskStatusToEnum(computedStatus ?? row.status),
    branch: row.branch,
    latestSessionId: latestSessionId ?? "",
    dependsOn: safeParseJsonArray(row.dependsOn),
    startedAt: row.startedAt ?? "",
    completedAt: row.completedAt ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sortOrder: row.sortOrder,
    parentTaskId: row.parentTaskId,
    depth: row.depth,
    childTaskIds: childIds ?? taskStore.getChildren(row.id).map((c) => c.id),
    canDecompose: row.canDecompose,
    defaultPersonaId: row.defaultPersonaId,
    workpad: row.workpad,
    scheduleId: row.scheduleId,
    tokenBudget: row.tokenBudget,
    costBudgetMillicents: row.costBudgetMillicents,
  });
}

/** Convert a finding database row to its proto representation. */
export function findingRowToProto(row: findingStore.FindingRow): grackle.Finding {
  return create(grackle.FindingSchema, {
    ...row,
    tags: safeParseJsonArray(row.tags),
  });
}

/** Convert an escalation database row to its proto representation. */
export function escalationRowToProto(row: escalationStore.EscalationRow): grackle.Escalation {
  return create(grackle.EscalationSchema, {
    id: row.id,
    workspaceId: row.workspaceId,
    taskId: row.taskId,
    title: row.title,
    message: row.message,
    source: row.source,
    urgency: row.urgency,
    status: row.status,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt ?? "",
    acknowledgedAt: row.acknowledgedAt ?? "",
    taskUrl: row.taskUrl,
  });
}

/** Safely parse a JSON string, returning the fallback value on failure. */
export function safeParseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Convert a persona database row to a Persona proto message. */
export function personaRowToProto(row: personaStore.PersonaRow): grackle.Persona {
  const toolConfig = safeParseJson<{
    allowedTools?: string[];
    disallowedTools?: string[];
  }>(row.toolConfig, {});
  const mcpServers = safeParseJson<
    { name: string; command: string; args?: string[]; tools?: string[] }[]
  >(row.mcpServers, []);
  return create(grackle.PersonaSchema, {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.systemPrompt,
    toolConfig: create(grackle.ToolConfigSchema, {
      allowedTools: Array.isArray(toolConfig.allowedTools)
        ? toolConfig.allowedTools.filter(
            (t): t is string => typeof t === "string",
          )
        : [],
      disallowedTools: Array.isArray(toolConfig.disallowedTools)
        ? toolConfig.disallowedTools.filter(
            (t): t is string => typeof t === "string",
          )
        : [],
    }),
    runtime: row.runtime,
    model: row.model,
    maxTurns: row.maxTurns,
    mcpServers: mcpServers
      .filter(
        (
          s,
        ): s is {
          name: string;
          command: string;
          args?: string[];
          tools?: string[];
        } =>
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- typeof null === "object", JSON.parse can return null
          s !== null &&
          typeof s === "object" &&
          typeof s.name === "string" &&
          typeof s.command === "string",
      )
      .map((s) =>
        create(grackle.McpServerConfigSchema, {
          name: s.name,
          command: s.command,
          args: Array.isArray(s.args)
            ? s.args.filter((a): a is string => typeof a === "string")
            : [],
          tools: Array.isArray(s.tools)
            ? s.tools.filter((t): t is string => typeof t === "string")
            : [],
        }),
      ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    type: row.type || "agent",
    script: row.script || "",
    allowedMcpTools: safeParseJson<string[]>(row.allowedMcpTools, []).filter(
      (t): t is string => typeof t === "string",
    ),
  });
}

/** Convert a KnowledgeNode to its proto representation. */
export function knowledgeNodeToProto(node: KnowledgeNode): grackle.KnowledgeNodeProto {
  return create(grackle.KnowledgeNodeProtoSchema, {
    id: node.id,
    kind: node.kind,
    workspaceId: node.workspaceId,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    sourceType: node.kind === "reference" ? node.sourceType : "",
    sourceId: node.kind === "reference" ? node.sourceId : "",
    label: node.kind === "reference" ? node.label : "",
    category: node.kind === "native" ? node.category : "",
    title: node.kind === "native" ? node.title : "",
    content: node.kind === "native" ? node.content : "",
    tags: node.kind === "native" ? node.tags : [],
  });
}

/** Convert a KnowledgeEdge to its proto representation. */
export function knowledgeEdgeToProto(edge: KnowledgeEdge): grackle.KnowledgeEdgeProto {
  return create(grackle.KnowledgeEdgeProtoSchema, {
    fromId: edge.fromId,
    toId: edge.toId,
    type: edge.type,
    metadataJson: edge.metadata ? JSON.stringify(edge.metadata) : "",
    createdAt: edge.createdAt,
  });
}

