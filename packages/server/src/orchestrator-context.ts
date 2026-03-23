/**
 * Fetches and assembles all data needed for the orchestrator system prompt.
 * Centralizes store reads so both gRPC and WebSocket call sites share
 * the same data-fetching logic.
 */
import type { TaskTreeNode, PersonaSummary, EnvironmentSummary } from "./system-prompt-builder.js";
import * as taskStore from "./task-store.js";
import * as personaStore from "./persona-store.js";
import * as envRegistry from "./env-registry.js";
import * as findingStore from "./finding-store.js";
import * as workspaceStore from "./workspace-store.js";
import { safeParseJsonArray } from "./json-helpers.js";

/** Pre-fetched orchestrator data matching SystemPromptOptions fields. */
export interface OrchestratorContext {
  /** Workspace metadata (undefined when workspace not found). */
  workspace?: { name: string; description: string; repoUrl: string };
  /** All tasks in the workspace mapped to tree nodes. */
  taskTree: TaskTreeNode[];
  /** All available personas. */
  availablePersonas: PersonaSummary[];
  /** All available environments. */
  availableEnvironments: EnvironmentSummary[];
  /** Pre-built findings context string. */
  findingsContext: string;
}

/**
 * Fetch all data needed for an orchestrator system prompt.
 *
 * @param workspaceId - The workspace to scope task/findings queries to.
 * @returns Data ready to spread into SystemPromptOptions.
 */
export function fetchOrchestratorContext(workspaceId: string): OrchestratorContext | undefined {
  // No workspace → no orchestrator context (root/System task)
  if (!workspaceId) {
    return undefined;
  }

  // Workspace metadata
  const ws = workspaceStore.getWorkspace(workspaceId);

  // All personas (used for both the roster and persona name resolution)
  const allPersonas = personaStore.listPersonas();
  const personaNameMap = new Map<string, string>();
  for (const p of allPersonas) {
    personaNameMap.set(p.id, p.name);
  }

  // All tasks in this workspace → TaskTreeNode[]
  const allTasks = taskStore.listTasks(workspaceId || undefined);
  const taskTree: TaskTreeNode[] = allTasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    depth: t.depth,
    parentTaskId: t.parentTaskId,
    dependsOn: safeParseJsonArray(t.dependsOn),
    personaName: personaNameMap.get(t.defaultPersonaId) || "",
    branch: t.branch,
    canDecompose: t.canDecompose,
  }));

  // Available personas
  const availablePersonas: PersonaSummary[] = allPersonas.map((p) => ({
    name: p.name,
    description: p.description,
    runtime: p.runtime,
    model: p.model,
  }));

  // Available environments
  const availableEnvironments: EnvironmentSummary[] = envRegistry.listEnvironments().map((e) => ({
    displayName: e.displayName,
    adapterType: e.adapterType,
    status: e.status,
    defaultRuntime: e.defaultRuntime,
  }));

  // Findings context (pre-formatted markdown with 8K char budget)
  const findingsContext = workspaceId
    ? buildFindingsContext(workspaceId)
    : "";

  return {
    workspace: ws ? {
      name: ws.name,
      description: ws.description,
      repoUrl: ws.repoUrl,
    } : undefined,
    taskTree,
    availablePersonas,
    availableEnvironments,
    findingsContext,
  };
}

// ─── Findings Context Builder ──────────────────────────────

/** Maximum total characters for the findings context block. */
const FINDINGS_MAX_CHARS: number = 8000;

/** Maximum characters per individual finding's content. */
const FINDINGS_MAX_PER_FINDING: number = 500;

/** Build a summarized text context of recent findings for a workspace. */
function buildFindingsContext(workspaceId: string): string {
  const allFindings = findingStore.queryFindings(workspaceId, undefined, undefined, 20);
  if (allFindings.length === 0) {
    return "";
  }

  const lines = ["## Workspace Findings (shared knowledge from other agents)\n"];
  let totalChars = lines[0].length;

  for (const f of allFindings) {
    const content = f.content.length > FINDINGS_MAX_PER_FINDING
      ? f.content.slice(0, FINDINGS_MAX_PER_FINDING) + "..."
      : f.content;
    const entry = `### [${f.category}] ${f.title}\n${content}\n`;
    if (totalChars + entry.length > FINDINGS_MAX_CHARS) {
      break;
    }
    lines.push(entry);
    totalChars += entry.length;
  }

  return lines.join("\n");
}
