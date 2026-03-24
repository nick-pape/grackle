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
   * `true` when the issue had more than the fetch limit of comments
   * and only the first batch was fetched. The imported description will
   * include a truncation notice when this is `true`.
   */
  commentsHasNextPage: boolean;
}

/** Instruction to create a single task during the persist phase. */
export interface TaskCreateInstruction {
  /** Provisional task ID (used for parent/dependency resolution within the plan). */
  id: string;
  /** Formatted title (e.g., "#42: Fix the bug"). */
  title: string;
  /** Full task description including comments. */
  description: string;
  /** Parent task ID (may be provisional within a plan, or a real existing task ID). */
  parentTaskId: string;
  /** Original GitHub issue number. */
  issueNumber: number;
}

/** Instruction to set dependsOn for a task during the persist phase. */
export interface DependencyInstruction {
  /** Provisional task ID to update. */
  taskId: string;
  /** Resolved provisional task IDs that this task depends on. */
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

/** Maximum number of comments fetched per issue in a single GraphQL page. */
export const COMMENTS_PER_ISSUE: number = 25;

/** Separator inserted between the issue body and each appended comment block. */
const COMMENT_SEPARATOR: string = "\n\n---\n\n";

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
 * Performs topological sort, skips existing issues, generates provisional IDs,
 * resolves parent links and blockedBy dependencies, and returns a plan.
 *
 * @param issues - Fetched GitHub issues to import.
 * @param existingIssueNumbers - Issue numbers already imported (to skip).
 * @param existingIssueNumberToTaskId - Map from issue number to existing task ID.
 * @param generateId - ID generator for provisional task IDs.
 * @returns An {@link ImportPlan} describing all tasks to create and dependencies to set.
 */
export function planImport(
  issues: GitHubIssue[],
  existingIssueNumbers: Set<number>,
  existingIssueNumberToTaskId: Map<number, string>,
  generateId: () => string,
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
  issueSet: Set<number>,
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
