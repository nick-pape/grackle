import { execFileSync } from "node:child_process";
import { v4 as uuid } from "uuid";
import * as taskStore from "./task-store.js";
import * as projectStore from "./project-store.js";
import { broadcast } from "./ws-broadcast.js";
import { slugify } from "./utils/slugify.js";
import { logger } from "./logger.js";

/** Maximum buffer size for `gh` CLI output (50 MB). */
const MAX_BUFFER_BYTES: number = 50 * 1024 * 1024;

/** Number of issues fetched per GraphQL page. */
const ISSUES_PER_PAGE: number = 100;

/** Shape of a GitHub issue as returned by the GraphQL query. */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  parentNumber: number | undefined;
  labels: string[];
}

/** Result summary returned by {@link importGitHubIssues}. */
export interface ImportResult {
  imported: number;
  linked: number;
  skipped: number;
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
export function fetchGitHubIssues(repo: string, state: string, label?: string): GitHubIssue[] {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    throw new Error("--repo must be in owner/repo format.");
  }

  const stateEnum = state.toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN";
  const issues: GitHubIssue[] = [];
  let cursor: string | undefined;
  let hasNextPage = true;

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
              labels(first: 10) { nodes { name } }
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
      ghOutput = execFileSync("gh", ghArgs, {
        encoding: "utf8",
        maxBuffer: MAX_BUFFER_BYTES,
      });
    } catch (err) {
      throw new Error(`Failed to fetch issues via GraphQL for ${repo} (state=${state}): ${err}`);
    }

    let parsed: {
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: boolean; endCursor: string | undefined };
            nodes: {
              number: number;
              title: string;
              body: string;
              parent: { number: number } | undefined;
              labels: { nodes: { name: string }[] };
            }[];
          };
        };
      };
    };
    try {
      parsed = JSON.parse(ghOutput);
    } catch (err) {
      throw new Error(`Failed to parse GraphQL response: ${err}`);
    }

    const issuesPage = parsed.data.repository.issues;
    for (const node of issuesPage.nodes) {
      issues.push({
        number: node.number,
        title: node.title,
        body: node.body,
        parentNumber: node.parent?.number ?? undefined,
        labels: node.labels.nodes.map((l) => l.name),
      });
    }

    hasNextPage = issuesPage.pageInfo.hasNextPage;
    cursor = issuesPage.pageInfo.endCursor;
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
 * @param projectId - The Grackle project ID to import tasks into.
 * @param repo - Repository in "owner/repo" format.
 * @param state - Issue state filter ("open" or "closed").
 * @param label - Optional label to filter issues by.
 * @param environmentId - Optional environment ID to assign to created tasks.
 * @returns Summary of imported, linked, and skipped issues.
 */
export function importGitHubIssues(
  projectId: string,
  repo: string,
  state: string,
  label?: string,
  environmentId?: string,
): ImportResult {
  const project = projectStore.getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const resolvedEnvironmentId = environmentId || project.defaultEnvironmentId;
  const projectSlug = slugify(project.name);

  // 1. Fetch issues from GitHub
  const issues = fetchGitHubIssues(repo, state, label);
  logger.info({ repo, state, label, count: issues.length }, "Fetched GitHub issues");

  // 2. Fetch existing tasks for deduplication and parent linking
  const existingTasks = taskStore.listTasks(projectId);
  const issueNumberPattern = /^#(\d+):/;

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
  let imported = 0;
  let skipped = 0;
  let linked = 0;

  for (const issue of sorted) {
    if (existingIssueNumbers.has(issue.number)) {
      skipped++;
      continue;
    }

    const title = `#${issue.number}: ${issue.title}`;
    let parentTaskId = "";
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
    );

    const row = taskStore.getTask(id);
    broadcast({ type: "task_created", payload: { task: row ? { ...row } : null } });
    issueNumberToTaskId.set(issue.number, id);
    imported++;
  }

  logger.info({ projectId, imported, linked, skipped }, "GitHub import complete");
  return { imported, linked, skipped };
}
