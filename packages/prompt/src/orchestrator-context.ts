/**
 * Builds the orchestrator context from pre-fetched data.
 * Pure function — no database or store dependencies.
 */
import type { TaskTreeNode, PersonaSummary, EnvironmentSummary } from "./system-prompt-builder.js";

// ─── Input Types (database-agnostic) ────────────────────────

/** Pre-parsed task data for building orchestrator context. */
export interface TaskInput {
  /** Task ID. */
  id: string;
  /** Task title. */
  title: string;
  /** Current lifecycle status. */
  status: string;
  /** Nesting depth in the hierarchy (0 = root). */
  depth: number;
  /** Parent task ID (empty string for root-level tasks). */
  parentTaskId: string;
  /** IDs of tasks this task depends on (pre-parsed from JSON). */
  dependsOn: string[];
  /** Default persona ID for this task. */
  defaultPersonaId: string;
  /** Git branch name (empty if none). */
  branch: string;
  /** Whether this task can create subtasks. */
  canDecompose: boolean;
}

/** Persona data for building orchestrator context. */
export interface PersonaInput {
  /** Persona ID. */
  id: string;
  /** Display name. */
  name: string;
  /** Short description. */
  description: string;
  /** Runtime backend. */
  runtime: string;
  /** Default model. */
  model: string;
}

/** Environment data for building orchestrator context. */
export interface EnvironmentInput {
  /** Human-readable name. */
  displayName: string;
  /** Adapter backend (local, ssh, codespace, docker). */
  adapterType: string;
  /** Connection status. */
  status: string;
  /** Default runtime for this environment. */
  defaultRuntime: string;
}

/** Finding data for building orchestrator context. */
export interface FindingInput {
  /** Finding category (decision, bug, pattern, etc.). */
  category: string;
  /** Finding title. */
  title: string;
  /** Finding content. */
  content: string;
}

/** All input data needed to build orchestrator context. */
export interface OrchestratorContextInput {
  /** Workspace metadata (undefined when workspace not found). */
  workspace?: { name: string; description: string; repoUrl: string };
  /** All tasks in the workspace. */
  tasks: TaskInput[];
  /** All available personas. */
  personas: PersonaInput[];
  /** All available environments. */
  environments: EnvironmentInput[];
  /** Recent findings for the workspace. */
  findings: FindingInput[];
}

/** Pre-built orchestrator data matching SystemPromptOptions fields. */
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
 * Build orchestrator context from pre-fetched data.
 *
 * @param input - Pre-fetched workspace, task, persona, environment, and finding data.
 * @returns Data ready to spread into SystemPromptOptions.
 */
export function buildOrchestratorContext(input: OrchestratorContextInput): OrchestratorContext {
  // Build persona ID → name map for task tree persona name resolution
  const personaNameMap = new Map<string, string>();
  for (const p of input.personas) {
    personaNameMap.set(p.id, p.name);
  }

  // Map tasks → TaskTreeNode[]
  const taskTree: TaskTreeNode[] = input.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    depth: t.depth,
    parentTaskId: t.parentTaskId,
    dependsOn: t.dependsOn,
    personaName: personaNameMap.get(t.defaultPersonaId) || "",
    branch: t.branch,
    canDecompose: t.canDecompose,
  }));

  // Map personas → PersonaSummary[]
  const availablePersonas: PersonaSummary[] = input.personas.map((p) => ({
    name: p.name,
    description: p.description,
    runtime: p.runtime,
    model: p.model,
  }));

  // Map environments → EnvironmentSummary[]
  const availableEnvironments: EnvironmentSummary[] = input.environments.map((e) => ({
    displayName: e.displayName,
    adapterType: e.adapterType,
    status: e.status,
    defaultRuntime: e.defaultRuntime,
  }));

  // Build findings context (pre-formatted markdown with 8K char budget)
  const findingsContext = buildFindingsContext(input.findings);

  return {
    workspace: input.workspace,
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

/** Build a summarized text context of recent findings. */
function buildFindingsContext(findings: FindingInput[]): string {
  if (findings.length === 0) {
    return "";
  }

  const lines = ["## Workspace Findings (shared knowledge from other agents)\n"];
  let totalChars = lines[0].length;

  for (const f of findings) {
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
