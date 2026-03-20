import { execFile } from "node:child_process";
import { v4 as uuid } from "uuid";
import * as taskStore from "./task-store.js";
import * as workspaceStore from "./workspace-store.js";
import { emit } from "./event-bus.js";
import { slugify } from "./utils/slugify.js";
import { logger } from "./logger.js";

/** Maximum buffer size for `gh` CLI output (50 MB). */
const MAX_BUFFER_BYTES: number = 50 * 1024 * 1024;

/** Default timeout for `gh` CLI invocations (5 minutes). */
const GH_CLI_TIMEOUT_MS: number = 5 * 60 * 1000;

/** Number of issues fetched per GraphQL page. */
const ISSUES_PER_PAGE: number = 100;

/**
 * Maximum number of comments fetched per issue in a single GraphQL page.
 *
 * Kept at 25 as a practical upper bound. Fetching 100 issues × N comments
 * per issue in one GraphQL request can produce very large payloads for
 * active repositories. Issues with more than this many comments will have
 * their descriptions annotated with a truncation notice.
 */
const COMMENTS_PER_ISSUE: number = 25;

/** Separator inserted between the issue body and each appended comment block. */
const COMMENT_SEPARATOR: string = "\n\n---\n\n";

/** Maximum number of blockedBy relationships fetched per issue. */
const BLOCKED_BY_PER_ISSUE: number = 25;

// ── Injectable Interfaces ───────────────────────────────────────

/** Wraps `gh` CLI execution for testability. */
export interface GitHubClient {
  /** Execute a `gh` CLI command and return stdout. */
  exec(args: string[], options: { encoding: BufferEncoding; maxBuffer: number; timeout?: number }): Promise<string>;
}

/** Wraps task/workspace store operations for testability. */
export interface TaskPersistence {
  /** Look up a workspace by ID. */
  getWorkspace(workspaceId: string): { name: string } | undefined;
  /** List all tasks in a workspace. */
  listTasks(workspaceId: string): Array<{ id: string; title: string }>;
  /** Create a new task. */
  createTask(
    id: string, workspaceId: string, title: string, description: string,
    dependsOn: string[], workspaceSlug: string, parentTaskId: string, canDecompose: boolean,
  ): void;
  /** Set the dependsOn list for a task. */
  setTaskDependsOn(taskId: string, dependsOn: string[]): void;
}

/** Wraps event bus broadcasting for testability. */
export interface ImportEventEmitter {
  /** Emit a task lifecycle event. */
  emit(type: "task.created" | "task.updated", payload: { taskId: string; workspaceId: string }): void;
}

/** Concurrency guard for imports. */
export interface ImportLock {
  /** Acquire the lock. Throws if already held. */
  acquire(): void;
  /** Release the lock. */
  release(): void;
}

// ── Default Implementations ─────────────────────────────────────

/** Default {@link GitHubClient} that shells out to the `gh` CLI. */
const NODE_GITHUB_CLIENT: GitHubClient = {
  exec(
    args: string[],
    options: { encoding: BufferEncoding; maxBuffer: number; timeout?: number },
  ): Promise<string> {
    const timeout = options.timeout ?? GH_CLI_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      execFile(
        "gh",
        args,
        { ...options, timeout },
        (err, stdout, stderr) => {
          if (err) {
            (err as NodeJS.ErrnoException & { stderr?: string }).stderr = String(stderr);
            reject(err);
          } else {
            resolve(String(stdout));
          }
        },
      );
    });
  },
};

/** Default {@link TaskPersistence} delegating to the real stores. */
const NODE_TASK_PERSISTENCE: TaskPersistence = {
  getWorkspace(workspaceId: string): { name: string } | undefined {
    return workspaceStore.getWorkspace(workspaceId);
  },
  listTasks(workspaceId: string): Array<{ id: string; title: string }> {
    return taskStore.listTasks(workspaceId);
  },
  createTask(
    id: string, workspaceId: string, title: string, description: string,
    dependsOn: string[], workspaceSlug: string, parentTaskId: string, canDecompose: boolean,
  ): void {
    taskStore.createTask(id, workspaceId, title, description, dependsOn, workspaceSlug, parentTaskId, canDecompose);
  },
  setTaskDependsOn(taskId: string, dependsOn: string[]): void {
    taskStore.setTaskDependsOn(taskId, dependsOn);
  },
};

/** Default {@link ImportEventEmitter} delegating to the real event bus. */
const NODE_IMPORT_EVENT_EMITTER: ImportEventEmitter = {
  emit(
    type: "task.created" | "task.updated",
    payload: { taskId: string; workspaceId: string },
  ): void {
    emit(type, payload);
  },
};

/**
 * Simple concurrency guard — only one import runs at a time within this process.
 * Does not prevent concurrent imports from separate server processes sharing the same DB.
 */
const importLockState: { active: boolean } = { active: false };

/** Default {@link ImportLock} using a process-global boolean. */
const DEFAULT_IMPORT_LOCK: ImportLock = {
  acquire() {
    if (importLockState.active) {
      throw new Error("An import is already in progress. Please wait for it to complete.");
    }
    importLockState.active = true;
  },
  release() {
    importLockState.active = false;
  },
};

// ── Data Types ──────────────────────────────────────────────────

/** Shape of a single GitHub issue comment as returned by the GraphQL query. */
export interface GitHubComment {
  /** Login of the comment author. */
  author: string;
  /** ISO-8601 timestamp of when the comment was created. */
  createdAt: string;
  /** Markdown body of the comment. */
  body: string;
}

/** Shape of a GitHub issue as returned by the GraphQL query. */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  parentNumber: number | undefined;
  labels: string[];
  /** Issue numbers that block this issue (i.e., this issue depends on them). */
  blockedByNumbers: number[];
  /** Comments on the issue. Empty array when fetched without `includeComments`. */
  comments: GitHubComment[];
  /**
   * `true` when the issue had more than {@link COMMENTS_PER_ISSUE} comments
   * and only the first batch was fetched. The imported description will
   * include a truncation notice when this is `true`.
   */
  commentsHasNextPage: boolean;
}

/** Result summary returned by {@link importGitHubIssues}. */
export interface ImportResult {
  imported: number;
  linked: number;
  skipped: number;
  /** Number of blocking (dependsOn) relationships created. */
  dependencies: number;
}

/** Instruction to create a single task during the persist phase. */
export interface TaskCreateInstruction {
  /** Generated task ID. */
  id: string;
  /** Formatted title (e.g., "#42: Fix the bug"). */
  title: string;
  /** Full task description including comments. */
  description: string;
  /** Resolved parent task ID, or empty string for root tasks. */
  parentTaskId: string;
  /** Original GitHub issue number. */
  issueNumber: number;
}

/** Instruction to set dependsOn for a task during the persist phase. */
export interface DependencyInstruction {
  /** Task ID to update. */
  taskId: string;
  /** Resolved task IDs that this task depends on. */
  dependsOn: string[];
}

/** The output of {@link planImport}: a pure description of what to persist. */
export interface ImportPlan {
  /** Tasks to create, in topological order. */
  tasksToCreate: TaskCreateInstruction[];
  /** Dependency relationships to set after task creation. */
  dependenciesToSet: DependencyInstruction[];
  /** Number of issues skipped because they already exist. */
  skipped: number;
  /** Number of parent links resolved. */
  linked: number;
}

/** Options for dependency injection in {@link importGitHubIssues}. */
export interface ImportGitHubIssuesOptions {
  /** @internal GitHub CLI client for testing. */
  githubClient?: GitHubClient;
  /** @internal Task/workspace persistence for testing. */
  persistence?: TaskPersistence;
  /** @internal Event broadcaster for testing. */
  eventEmitter?: ImportEventEmitter;
  /** @internal Concurrency lock for testing. */
  importLock?: ImportLock;
  /** @internal ID generator for testing. */
  generateId?: () => string;
}

// ── Helper Functions ────────────────────────────────────────────

/**
 * Extracts a human-readable message from an unknown error value.
 *
 * @param err - The caught error value.
 * @returns A string suitable for logging or re-throwing.
 */
function formatError(err: unknown): string {
  if (err instanceof Error) {
    const stderr = (err as NodeJS.ErrnoException & { stderr?: string }).stderr;
    return stderr ? `${err.message} (stderr: ${stderr})` : err.message;
  }
  return String(err);
}

/**
 * Builds the full task description from an issue body and its comments.
 *
 * Comments are appended after the body, each preceded by a `---` separator
 * and a header line showing the author login and creation timestamp.
 * When `hasMoreComments` is `true`, a truncation notice is appended after
 * the last fetched comment to indicate that additional comments exist.
 *
 * @param body - The issue body text (may be empty).
 * @param comments - Array of comments to append. Pass an empty array to omit.
 * @param hasMoreComments - When `true`, appends a notice that the comment list
 *   was truncated at the fetch limit.
 * @returns The formatted description string.
 */
export function buildDescriptionWithComments(
  body: string,
  comments: GitHubComment[],
  hasMoreComments: boolean = false,
): string {
  if (comments.length === 0) {
    return body;
  }

  const commentBlocks = comments.map((c) => {
    const header = `**@${c.author}** — ${c.createdAt}`;
    return `${header}\n\n${c.body}`;
  });

  let result = body + COMMENT_SEPARATOR + commentBlocks.join(COMMENT_SEPARATOR);

  if (hasMoreComments) {
    result += `${COMMENT_SEPARATOR}> **Note:** This issue has additional comments that were not fetched (limit: ${COMMENTS_PER_ISSUE}). View the full discussion on GitHub.`;
  }

  return result;
}

// ── Pure Transform Functions ────────────────────────────────────

/**
 * Builds a deduplication map from existing tasks whose titles match
 * the `#<number>: <title>` pattern used by imported GitHub issues.
 *
 * @param existingTasks - Tasks already in the workspace.
 * @returns Maps and sets for deduplication during import planning.
 */
export function buildExistingIssueMap(
  existingTasks: Array<{ id: string; title: string }>,
): { issueNumberToTaskId: Map<number, string>; existingIssueNumbers: Set<number> } {
  const issueNumberPattern: RegExp = /^#(\d+):/;
  const issueNumberToTaskId = new Map<number, string>();
  const existingIssueNumbers = new Set<number>();

  for (const t of existingTasks) {
    const match = t.title.match(issueNumberPattern);
    if (match) {
      const num = Number(match[1]);
      existingIssueNumbers.add(num);
      issueNumberToTaskId.set(num, t.id);
    }
  }

  return { issueNumberToTaskId, existingIssueNumbers };
}

/**
 * Given fetched issues and existing state, computes what to create and link
 * without performing any side effects.
 *
 * Performs topological sort, skips existing issues, generates IDs upfront,
 * resolves parent links and blockedBy dependencies, and returns a plan.
 *
 * @param issues - Fetched GitHub issues to import.
 * @param existingIssueNumbers - Issue numbers already imported (to skip).
 * @param existingIssueNumberToTaskId - Map from issue number to existing task ID.
 * @param generateId - Optional ID generator (defaults to `uuid().slice(0, 8)`).
 * @returns An {@link ImportPlan} describing all tasks to create and dependencies to set.
 */
export function planImport(
  issues: GitHubIssue[],
  existingIssueNumbers: Set<number>,
  existingIssueNumberToTaskId: Map<number, string>,
  generateId: () => string = () => uuid().slice(0, 8),
): ImportPlan {
  // Topological sort: parents before children
  const issueSet = new Set(issues.map((i) => i.number));
  const sorted = topologicalSortIssues(issues, issueSet);

  // Mutable copy of the issue→taskId map so we can track newly generated IDs
  const issueNumberToTaskId = new Map(existingIssueNumberToTaskId);

  const tasksToCreate: TaskCreateInstruction[] = [];
  const dependenciesToSet: DependencyInstruction[] = [];
  let skipped: number = 0;
  let linked: number = 0;

  // First pass: generate IDs and resolve parent links
  for (const issue of sorted) {
    if (existingIssueNumbers.has(issue.number)) {
      skipped++;
      continue;
    }

    const id = generateId();
    issueNumberToTaskId.set(issue.number, id);

    const title = `#${issue.number}: ${issue.title}`;
    let parentTaskId: string = "";
    if (issue.parentNumber !== undefined) {
      const resolvedParentId = issueNumberToTaskId.get(issue.parentNumber);
      if (resolvedParentId) {
        parentTaskId = resolvedParentId;
        linked++;
      }
    }

    const description = buildDescriptionWithComments(issue.body, issue.comments, issue.commentsHasNextPage);

    tasksToCreate.push({ id, title, description, parentTaskId, issueNumber: issue.number });
  }

  // Build a map for O(1) lookup of issues by number during dependency resolution
  const issueNumberToIssue = new Map<number, GitHubIssue>();
  for (const issue of sorted) {
    issueNumberToIssue.set(issue.number, issue);
  }

  // Second pass: resolve blockedBy → dependsOn for newly created tasks only
  for (const instruction of tasksToCreate) {
    const issue = issueNumberToIssue.get(instruction.issueNumber);
    if (!issue || issue.blockedByNumbers.length === 0) {
      continue;
    }

    const resolvedDeps: string[] = [];
    for (const blockerNumber of issue.blockedByNumbers) {
      const blockerTaskId = issueNumberToTaskId.get(blockerNumber);
      if (blockerTaskId) {
        resolvedDeps.push(blockerTaskId);
      }
    }

    if (resolvedDeps.length > 0) {
      dependenciesToSet.push({ taskId: instruction.id, dependsOn: resolvedDeps });
    }
  }

  return { tasksToCreate, dependenciesToSet, skipped, linked };
}

// ── Fetch Function ──────────────────────────────────────────────

/**
 * Fetches GitHub issues from a repository via the `gh` CLI GraphQL API.
 * Paginates automatically and includes parent sub-issue information.
 *
 * @param repo - Repository in "owner/repo" format.
 * @param state - Issue state filter ("open" or "closed").
 * @param label - Optional label to filter issues by (client-side).
 * @param includeComments - When `true` (default), fetches issue comments and
 *   includes them in each returned {@link GitHubIssue}. Pass `false` to omit
 *   comments and reduce payload size.
 * @param client - Optional {@link GitHubClient} for testing (defaults to `gh` CLI).
 * @returns Array of parsed GitHub issues.
 */
export async function fetchGitHubIssues(
  repo: string,
  state: string,
  label?: string,
  includeComments: boolean = true,
  client: GitHubClient = NODE_GITHUB_CLIENT,
): Promise<GitHubIssue[]> {
  const segments = repo.split("/");
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw new Error(`repo must be in "owner/repo" format (received: "${repo}")`);
  }
  const [owner, repoName] = segments;

  const upper = state.toUpperCase();
  if (upper !== "OPEN" && upper !== "CLOSED") {
    throw new Error(`state must be "open" or "closed" (received: "${state}")`);
  }
  const stateEnum = upper;
  const issues: GitHubIssue[] = [];
  let cursor: string | undefined;
  let hasNextPage: boolean = true;

  const commentsFragment = includeComments
    ? `comments(first: ${COMMENTS_PER_ISSUE}) {
              pageInfo { hasNextPage }
              nodes {
                author { login }
                createdAt
                body
              }
            }`
    : "";

  while (hasNextPage) {
    const query = `
      query($owner: String!, $repo: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          issues(first: ${ISSUES_PER_PAGE}, states: [${stateEnum}], after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              number
              title
              body
              parent { number }
              labels(first: 100) { nodes { name } }
              blockedBy(first: ${BLOCKED_BY_PER_ISSUE}) { nodes { number } }
              ${commentsFragment}
            }
          }
        }
      }`;

    const ghArgs = [
      "api", "graphql",
      "-f", `query=${query}`,
      "-f", `owner=${owner}`,
      "-f", `repo=${repoName}`,
    ];
    if (cursor !== undefined) {
      ghArgs.push("-f", `cursor=${cursor}`);
    }

    let ghOutput: string;
    try {
      ghOutput = await client.exec(ghArgs, {
        encoding: "utf8",
        maxBuffer: MAX_BUFFER_BYTES,
      });
    } catch (err) {
      throw new Error(`Failed to fetch issues via GraphQL for ${repo} (state=${state}): ${formatError(err)}`);
    }

    let parsed: {
      errors?: { message: string }[];
      data?: {
        repository?: {
          issues: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: {
              number: number;
              title: string;
              body: string;
              parent: { number: number } | null;
              labels: { nodes: { name: string }[] };
              blockedBy: { nodes: { number: number }[] };
              comments?: {
                pageInfo: { hasNextPage: boolean };
                nodes: {
                  author: { login: string } | null;
                  createdAt: string;
                  body: string;
                }[];
              };
            }[];
          };
        };
      };
    };
    try {
      parsed = JSON.parse(ghOutput) as typeof parsed;
    } catch (err) {
      throw new Error(`Failed to parse GraphQL response: ${formatError(err)}`);
    }

    if (parsed.errors && parsed.errors.length > 0) {
      const messages = parsed.errors.map((e) => e.message).join("; ");
      throw new Error(`GraphQL errors for ${repo}: ${messages}`);
    }

    if (!parsed.data?.repository) {
      throw new Error(`Repository not found or inaccessible: ${repo}`);
    }

    const issuesPage = parsed.data.repository.issues;
    for (const node of issuesPage.nodes) {
      const comments: GitHubComment[] = (node.comments?.nodes ?? []).map((c) => ({
        author: c.author?.login ?? "ghost",
        createdAt: c.createdAt,
        body: c.body,
      }));

      issues.push({
        number: node.number,
        title: node.title,
        body: node.body,
        parentNumber: node.parent?.number ?? undefined,
        labels: node.labels.nodes.map((l) => l.name),
        blockedByNumbers: node.blockedBy.nodes.map((b) => b.number),
        comments,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- pageInfo may be undefined when comments is present but empty
        commentsHasNextPage: node.comments?.pageInfo?.hasNextPage ?? false,
      });
    }

    hasNextPage = issuesPage.pageInfo.hasNextPage;
    cursor = issuesPage.pageInfo.endCursor ?? undefined;
  }

  // Filter by label client-side (GraphQL filterBy labels requires exact match array)
  if (label) {
    const beforeCount = issues.length;
    const filtered = issues.filter((i) => i.labels.includes(label));
    if (filtered.length < beforeCount) {
      logger.info({ label, before: beforeCount, after: filtered.length }, "Filtered issues by label");
    }
    return filtered;
  }

  return issues;
}

// ── Topological Sort ────────────────────────────────────────────

/**
 * Topologically sorts issues so that parents appear before their children.
 * Issues whose parent is outside the import set are treated as roots.
 * Falls back to original order for issues at the same depth.
 *
 * @param issues - The list of GitHub issues to sort.
 * @param issueSet - Set of issue numbers in the current import batch.
 * @returns A new array of issues sorted with parents before children.
 */
export function topologicalSortIssues<T extends { number: number; parentNumber: number | undefined }>(
  issues: T[],
  issueSet: Set<number>
): T[] {
  const issueByNumber = new Map(issues.map((i) => [i.number, i]));
  const visited = new Set<number>();
  const sorted: T[] = [];

  function visit(issue: T): void {
    if (visited.has(issue.number)) {
      return;
    }
    visited.add(issue.number);

    // Visit parent first if it's in the import set
    if (issue.parentNumber !== undefined && issueSet.has(issue.parentNumber)) {
      const parent = issueByNumber.get(issue.parentNumber);
      if (parent) {
        visit(parent);
      }
    }

    sorted.push(issue);
  }

  for (const issue of issues) {
    visit(issue);
  }

  return sorted;
}

// ── Main Entry Point ────────────────────────────────────────────

/**
 * Imports GitHub issues as Grackle tasks, with deduplication and parent linking.
 *
 * Orchestrates: fetch issues → dedup against existing tasks → plan (pure) →
 * persist tasks → broadcast updates → return summary.
 *
 * Only one import may run at a time; concurrent calls are rejected.
 *
 * @param workspaceId - The Grackle workspace ID to import tasks into.
 * @param repo - Repository in "owner/repo" format.
 * @param state - Issue state filter ("open" or "closed").
 * @param label - Optional label to filter issues by.
 * @param environmentId - Optional environment ID to assign to created tasks.
 * @param includeComments - When `true` (default), appends issue comments to each
 *   task description. Pass `false` to import only the issue body (old behavior).
 * @param options - Optional dependency overrides for testing.
 * @returns Summary of imported, linked, and skipped issues.
 */
export async function importGitHubIssues(
  workspaceId: string,
  repo: string,
  state: string,
  label?: string,
  _environmentId?: string,
  includeComments: boolean = true,
  options: ImportGitHubIssuesOptions = {},
): Promise<ImportResult> {
  const lock = options.importLock ?? DEFAULT_IMPORT_LOCK;
  lock.acquire();
  try {
    const client = options.githubClient ?? NODE_GITHUB_CLIENT;
    const persistence = options.persistence ?? NODE_TASK_PERSISTENCE;
    const emitter = options.eventEmitter ?? NODE_IMPORT_EVENT_EMITTER;
    const generateId = options.generateId ?? (() => uuid().slice(0, 8));

    // 1. Validate workspace
    const workspace = persistence.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    const workspaceSlug = slugify(workspace.name);

    // 2. FETCH — get issues from GitHub
    const issues = await fetchGitHubIssues(repo, state, label, includeComments, client);
    logger.info({ repo, state, label, count: issues.length, includeComments }, "Fetched GitHub issues");

    // 3. Read existing state for deduplication
    const existingTasks = persistence.listTasks(workspaceId);
    const { issueNumberToTaskId, existingIssueNumbers } = buildExistingIssueMap(existingTasks);

    // 4. TRANSFORM — pure planning step
    const plan = planImport(issues, existingIssueNumbers, issueNumberToTaskId, generateId);

    // 5. PERSIST — create tasks
    for (const task of plan.tasksToCreate) {
      persistence.createTask(
        task.id, workspaceId, task.title, task.description,
        [], workspaceSlug, task.parentTaskId, true,
      );
      emitter.emit("task.created", { taskId: task.id, workspaceId });
    }

    // 6. PERSIST — set dependency relationships
    let dependencies: number = 0;
    for (const dep of plan.dependenciesToSet) {
      persistence.setTaskDependsOn(dep.taskId, dep.dependsOn);
      dependencies += dep.dependsOn.length;
      emitter.emit("task.updated", { taskId: dep.taskId, workspaceId });
    }

    logger.info(
      { workspaceId, imported: plan.tasksToCreate.length, linked: plan.linked, skipped: plan.skipped, dependencies },
      "GitHub import complete",
    );
    return { imported: plan.tasksToCreate.length, linked: plan.linked, skipped: plan.skipped, dependencies };
  } finally {
    lock.release();
  }
}
