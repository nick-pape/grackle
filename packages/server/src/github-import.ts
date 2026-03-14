import { execFile } from "node:child_process";
import { v4 as uuid } from "uuid";
import * as taskStore from "./task-store.js";
import * as projectStore from "./project-store.js";
import { broadcast } from "./ws-broadcast.js";
import { slugify } from "./utils/slugify.js";
import { logger } from "./logger.js";

/** Maximum buffer size for `gh` CLI output (50 MB). */
const MAX_BUFFER_BYTES: number = 50 * 1024 * 1024;

/** Default timeout for `gh` CLI invocations (5 minutes). */
const GH_CLI_TIMEOUT_MS: number = 5 * 60 * 1000;

/**
 * Promise wrapper around `execFile` that resolves with stdout as a string.
 * Includes a timeout to prevent hanging the import lock if `gh` stalls.
 */
function execFileAsync(
  command: string,
  args: string[],
  options: { encoding: BufferEncoding; maxBuffer: number; timeout?: number },
): Promise<string> {
  const timeout = options.timeout ?? GH_CLI_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    execFile(
      command,
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
}

/** Number of issues fetched per GraphQL page. */
const ISSUES_PER_PAGE: number = 100;

/** Maximum number of blockedBy relationships fetched per issue. */
const BLOCKED_BY_PER_ISSUE: number = 25;

/**
 * Simple concurrency guard — only one import runs at a time within this process.
 * Does not prevent concurrent imports from separate server processes sharing the same DB.
 */
const importLock: { active: boolean } = { active: false };

/** Acquire the import lock. Throws if already held. */
function acquireImportLock(): void {
  if (importLock.active) {
    throw new Error("An import is already in progress. Please wait for it to complete.");
  }
  importLock.active = true;
}

/** Release the import lock. */
function releaseImportLock(): void {
  importLock.active = false;
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
}

/** Result summary returned by {@link importGitHubIssues}. */
export interface ImportResult {
  imported: number;
  linked: number;
  skipped: number;
  /** Number of blocking (dependsOn) relationships created. */
  dependencies: number;
}

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
 * Fetches GitHub issues from a repository via the `gh` CLI GraphQL API.
 * Paginates automatically and includes parent sub-issue information.
 *
 * @param repo - Repository in "owner/repo" format.
 * @param state - Issue state filter ("open" or "closed").
 * @param label - Optional label to filter issues by (client-side).
 * @returns Array of parsed GitHub issues.
 */
export async function fetchGitHubIssues(repo: string, state: string, label?: string): Promise<GitHubIssue[]> {
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
      ghOutput = await execFileAsync("gh", ghArgs, {
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
            }[];
          };
        };
      };
    };
    try {
      parsed = JSON.parse(ghOutput);
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
      issues.push({
        number: node.number,
        title: node.title,
        body: node.body,
        parentNumber: node.parent?.number ?? undefined,
        labels: node.labels.nodes.map((l) => l.name),
        blockedByNumbers: node.blockedBy.nodes.map((b) => b.number),
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

/**
 * Imports GitHub issues as Grackle tasks, with deduplication and parent linking.
 *
 * Orchestrates: fetch issues → dedup against existing tasks → topological sort →
 * create tasks with parent linking → broadcast updates → return summary.
 *
 * Only one import may run at a time; concurrent calls are rejected.
 *
 * @param projectId - The Grackle project ID to import tasks into.
 * @param repo - Repository in "owner/repo" format.
 * @param state - Issue state filter ("open" or "closed").
 * @param label - Optional label to filter issues by.
 * @param environmentId - Optional environment ID to assign to created tasks.
 * @returns Summary of imported, linked, and skipped issues.
 */
export async function importGitHubIssues(
  projectId: string,
  repo: string,
  state: string,
  label?: string,
  environmentId?: string,
): Promise<ImportResult> {
  acquireImportLock();
  try {
    return await doImport(projectId, repo, state, label, environmentId);
  } finally {
    releaseImportLock();
  }
}

/**
 * Internal import implementation, called under the concurrency guard.
 *
 * @param projectId - The Grackle project ID to import tasks into.
 * @param repo - Repository in "owner/repo" format.
 * @param state - Issue state filter ("open" or "closed").
 * @param label - Optional label to filter issues by.
 * @param environmentId - Optional environment ID to assign to created tasks.
 * @returns Summary of imported, linked, and skipped issues.
 */
async function doImport(
  projectId: string,
  repo: string,
  state: string,
  label?: string,
  environmentId?: string,
): Promise<ImportResult> {
  const project = projectStore.getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const resolvedEnvironmentId = environmentId || project.defaultEnvironmentId;
  const projectSlug = slugify(project.name);

  // 1. Fetch issues from GitHub
  const issues = await fetchGitHubIssues(repo, state, label);
  logger.info({ repo, state, label, count: issues.length }, "Fetched GitHub issues");

  // 2. Fetch existing tasks for deduplication and parent linking
  const existingTasks = taskStore.listTasks(projectId);
  const issueNumberPattern: RegExp = /^#(\d+):/;

  /** Maps GitHub issue number → Grackle task ID (for both existing and newly created tasks). */
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

  // 3. Topological sort: parents before children
  const issueSet = new Set(issues.map((i) => i.number));
  const sorted = topologicalSortIssues(issues, issueSet);

  // 4. Create tasks in topological order with parent linking
  let imported: number = 0;
  let skipped: number = 0;
  let linked: number = 0;

  /** Tracks newly imported issues (not previously existing) for dependency resolution. */
  const newlyImportedIssues: GitHubIssue[] = [];

  for (const issue of sorted) {
    if (existingIssueNumbers.has(issue.number)) {
      skipped++;
      continue;
    }

    const title = `#${issue.number}: ${issue.title}`;
    let parentTaskId: string = "";
    if (issue.parentNumber !== undefined) {
      const resolvedParentId = issueNumberToTaskId.get(issue.parentNumber);
      if (resolvedParentId) {
        parentTaskId = resolvedParentId;
        linked++;
      }
    }

    const id = uuid().slice(0, 8);
    taskStore.createTask(
      id,
      projectId,
      title,
      issue.body ?? "",
      resolvedEnvironmentId,
      [],
      projectSlug,
      parentTaskId,
      true,
    );

    const row = taskStore.getTask(id);
    broadcast({ type: "task_created", payload: { task: row ? { ...row } : null } });
    issueNumberToTaskId.set(issue.number, id);
    newlyImportedIssues.push(issue);
    imported++;
  }

  // 5. Second pass: resolve blockedBy relationships into dependsOn arrays.
  //    Only link relationships where both blocker and blocked are known tasks
  //    (either newly imported or pre-existing). Skip external blockers silently.
  //    Re-imported (skipped) issues are not updated — their existing dependsOn is preserved.
  let dependencies: number = 0;

  for (const issue of newlyImportedIssues) {
    if (issue.blockedByNumbers.length === 0) {
      continue;
    }

    const taskId = issueNumberToTaskId.get(issue.number);
    if (!taskId) {
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
      taskStore.setTaskDependsOn(taskId, resolvedDeps);
      dependencies += resolvedDeps.length;
    }
  }

  logger.info({ projectId, imported, linked, skipped, dependencies }, "GitHub import complete");
  return { imported, linked, skipped, dependencies };
}
