import { execFile } from "node:child_process";
import type { GitHubIssue, GitHubComment } from "./transform.js";

/** Maximum buffer size for `gh` CLI output (50 MB). */
const MAX_BUFFER_BYTES: number = 50 * 1024 * 1024;

/** Default timeout for `gh` CLI invocations (5 minutes). */
const GH_CLI_TIMEOUT_MS: number = 5 * 60 * 1000;

/** Number of issues fetched per GraphQL page. */
const ISSUES_PER_PAGE: number = 100;

/**
 * Maximum number of comments fetched per issue in a single GraphQL page.
 *
 * Kept at 25 as a practical upper bound. Fetching 100 issues x N comments
 * per issue in one GraphQL request can produce very large payloads for
 * active repositories. Issues with more than this many comments will have
 * their descriptions annotated with a truncation notice.
 */
const COMMENTS_PER_ISSUE: number = 25;

/** Maximum number of blockedBy relationships fetched per issue. */
const BLOCKED_BY_PER_ISSUE: number = 25;

/** Wraps `gh` CLI execution for testability. */
export interface GitHubClient {
  /** Execute a `gh` CLI command and return stdout. */
  exec(args: string[], options: { encoding: BufferEncoding; maxBuffer: number; timeout?: number }): Promise<string>;
}

/** Default {@link GitHubClient} that shells out to the `gh` CLI. */
export const DEFAULT_GITHUB_CLIENT: GitHubClient = {
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
  client: GitHubClient = DEFAULT_GITHUB_CLIENT,
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
      console.log(`Filtered ${beforeCount} issues to ${filtered.length} by label "${label}"`);
    }
    return filtered;
  }

  return issues;
}
