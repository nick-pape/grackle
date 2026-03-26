/**
 * PR Readiness Check — Stop Hook
 *
 * This script runs as a Claude Code Stop hook. It prevents the agent from
 * stopping if the current branch has an open PR that isn't ready to merge.
 *
 * Exit codes:
 *   0 — Allow stop (no PR, or PR is ready, or rate-limited)
 *   2 — Block stop (PR has issues; message on stderr tells agent what to fix)
 *
 * Checks performed (all in a single GraphQL query):
 *   1. Merge conflicts (PR mergeable state)
 *   2. CI status (all checks passing)
 *   3. Unresolved Copilot review threads
 *
 * Fail-closed: blocks on auth failures, network errors, and unexpected API
 * responses. The only exception is rate-limit errors, which exit 0 so agents
 * aren't stuck in a retry loop that burns even more quota.
 */

import { execSync } from "node:child_process";

/** Poll interval (seconds) for `gh pr checks --watch`. */
const CHECK_WATCH_INTERVAL_SECONDS = 60;

const FAILING_CONCLUSIONS = new Set([
  "FAILURE", "ERROR", "TIMED_OUT", "CANCELLED",
  "ACTION_REQUIRED", "STALE", "STARTUP_FAILURE",
]);

const PENDING_STATUSES = new Set([
  "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "",
]);

/**
 * Run a command and return its stdout (trimmed) and stderr.
 *
 * Returns an object:
 *   - On success: { stdout: string, stderr: string } (stderr usually empty).
 *   - On failure: { stdout: null, stderr: string, error: Error }.
 */
function run(cmd, options) {
  try {
    const result = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    });
    return { stdout: result.trim(), stderr: "" };
  } catch (error) {
    return {
      stdout: null,
      stderr: (error.stderr || "") + (error.stdout || ""),
      error,
    };
  }
}

function block(message) {
  process.stderr.write(message + "\n");
  process.exit(2);
}

/**
 * Detect GitHub API rate-limit errors in command output.
 */
function isRateLimited(text) {
  return /rate limit/i.test(text) || /API rate limit exceeded/i.test(text);
}

/**
 * Parse owner/repo from the git remote URL (no API call needed).
 */
function getOwnerRepo() {
  const result = run("git remote get-url origin");
  if (!result.stdout) {
    return null;
  }
  // Handles both HTTPS and SSH remote URLs
  const match = result.stdout.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!match) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

function main() {
  // Check that gh CLI is available (local check, no API call)
  const ghVersion = run("gh --version");
  if (!ghVersion.stdout) {
    block("gh CLI is not installed. Install it to enable PR readiness checks.");
  }

  // Get current branch name (local, no API call)
  const branchResult = run("git branch --show-current");
  if (!branchResult.stdout) {
    // Detached HEAD or not in a git repo — nothing to check
    process.exit(0);
  }
  const branch = branchResult.stdout;

  // Parse owner/repo from git remote (local, no API call)
  const ownerRepo = getOwnerRepo();
  if (!ownerRepo) {
    block("Could not parse owner/repo from git remote. Ensure the remote URL is set.");
  }
  const { owner, repo } = ownerRepo;

  // ── Single GraphQL query for everything ──────────────────────────
  const graphqlQuery = JSON.stringify({
    query: `query($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(headRefName: $branch, states: [OPEN, MERGED, CLOSED], first: 1, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        state
        mergeable
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  pageInfo { hasNextPage }
                  nodes {
                    ... on CheckRun {
                      conclusion
                      status
                    }
                    ... on StatusContext {
                      state
                    }
                  }
                }
              }
            }
          }
        }
        reviewThreads(first: 100) {
          pageInfo { hasNextPage }
          nodes {
            isResolved
            isOutdated
            comments(first: 1) {
              nodes {
                author { login }
              }
            }
          }
        }
      }
    }
  }
}`,
    variables: { owner, repo, branch },
  });

  const result = run("gh api graphql --input -", { input: graphqlQuery });

  // ── Rate limit / transient error handling ─────────────────────────
  if (!result.stdout) {
    const output = result.stderr || "";
    if (isRateLimited(output)) {
      // Rate-limited — let the agent stop rather than spinning and burning more quota
      process.exit(0);
    }
    if (/authentication|auth|login|credentials/i.test(output) && !isRateLimited(output)) {
      block("gh CLI is not authenticated. Run: gh auth login");
    }
    block(`Failed to query GitHub API: ${output.trim()}. Fix gh auth or network, then retry.`);
  }

  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    block(`Failed to parse GitHub API response. Raw output: ${result.stdout}`);
  }

  // Check for GraphQL-level rate limiting
  if (data.errors?.some((e) => /rate limit/i.test(e.message || ""))) {
    process.exit(0);
  }

  if (data.errors?.length > 0 || !data.data?.repository?.pullRequests) {
    const errorMessage = data.errors?.map((e) => e.message).join(", ") || "unexpected response shape";
    block(`GitHub API error: ${errorMessage}. Check gh auth and retry.`);
  }

  const prNodes = data.data.repository.pullRequests.nodes || [];
  if (prNodes.length === 0) {
    // No PR on this branch — allow stop
    process.exit(0);
  }

  const pr = prNodes[0];
  const prNumber = pr.number;

  // ── Check 0: PR already merged or closed ──────────────────────────
  if (pr.state === "MERGED" || pr.state === "CLOSED") {
    // Detect if we're in a git worktree (vs the main working copy)
    const worktreeCheck = run("git rev-parse --git-common-dir");
    const gitDir = run("git rev-parse --git-dir");
    const isWorktree = worktreeCheck.stdout && gitDir.stdout && worktreeCheck.stdout !== gitDir.stdout;

    if (isWorktree) {
      const cwd = run("pwd -P").stdout || process.cwd();
      block(
        `PR #${prNumber} is already ${pr.state}. This is a worktree — clean it up:\n` +
        `  git worktree remove "${cwd}"\n` +
        `  # or if the directory is already gone:\n` +
        `  git worktree prune`
      );
    } else {
      block(
        `PR #${prNumber} is already ${pr.state}. Switch back to main and pull:\n` +
        `  git checkout main && git pull\n\n` +
        `This will clear the stale branch context so the hook passes.`
      );
    }
  }

  const issues = [];

  // ── Check 1: Merge conflicts ──────────────────────────────────────
  if (pr.mergeable === "CONFLICTING") {
    issues.push(`PR #${prNumber} has MERGE CONFLICTS. Run: git fetch origin && git merge origin/main (NEVER rebase), resolve conflicts, commit, and push.`);
  } else if (pr.mergeable === "UNKNOWN" || !pr.mergeable) {
    issues.push(`PR #${prNumber} merge status is UNKNOWN (GitHub may still be computing). Wait a moment and retry.`);
  }

  // ── Check 2: CI status ────────────────────────────────────────────
  const commitNode = pr.commits?.nodes?.[0]?.commit;
  const contextsConnection = commitNode?.statusCheckRollup?.contexts;
  const checkContexts = contextsConnection?.nodes || [];
  const checksHasNextPage = contextsConnection?.pageInfo?.hasNextPage || false;

  let ciState;
  if (checkContexts.length === 0) {
    ciState = "PENDING";
  } else {
    const conclusions = checkContexts.map((c) => c.conclusion || c.status || c.state || "");
    if (conclusions.some((c) => FAILING_CONCLUSIONS.has(c))) {
      ciState = "FAILING";
    } else if (conclusions.some((c) => PENDING_STATUSES.has(c))) {
      ciState = "PENDING";
    } else if (checksHasNextPage) {
      // More than 100 checks — we can't confirm all are passing
      ciState = "PENDING";
    } else {
      ciState = "PASSING";
    }
  }

  if (ciState === "FAILING") {
    issues.push(`PR #${prNumber} has FAILING CI checks. Read the failed log with: gh run view <RUN_ID> --log-failed, fix the issue, commit, and push.`);
  } else if (ciState === "PENDING") {
    const truncationNote = checksHasNextPage ? " (Note: PR has >100 checks; verify manually on GitHub.)" : "";
    issues.push(`PR #${prNumber} CI checks are still RUNNING.${truncationNote} Wait for them to complete: gh pr checks ${prNumber} --watch --fail-fast -i ${CHECK_WATCH_INTERVAL_SECONDS}`);
  }

  // ── Check 3: Unresolved Copilot review threads ────────────────────
  const threadsConnection = pr.reviewThreads;
  const threads = threadsConnection?.nodes || [];
  const threadsHasNextPage = threadsConnection?.pageInfo?.hasNextPage || false;
  const unresolvedCount = threads.filter(
    (t) => !t.isResolved && t.comments?.nodes?.[0]?.author?.login === "copilot-pull-request-reviewer"
  ).length;

  if (unresolvedCount > 0 || threadsHasNextPage) {
    const count = threadsHasNextPage && unresolvedCount === 0
      ? "possible additional"
      : String(unresolvedCount);
    const truncationNote = threadsHasNextPage ? " (PR has >100 review threads; there may be more.)" : "";
    issues.push(`PR #${prNumber} has ${count} unresolved Copilot review thread(s).${truncationNote} For each: read the suggestion, fix the code or dismiss with explanation, reply to the comment, and resolve the thread.`);
  }

  // ── Decision ──────────────────────────────────────────────────────
  if (issues.length > 0) {
    const bulletList = issues.map((i) => `- ${i}`).join("\n");
    block(
      `PR #${prNumber} is NOT ready. You must fix these issues before stopping:\n${bulletList}\n\nAfter fixing, commit and push, then wait for CI and Copilot review to complete.`
    );
  }

  process.exit(0);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // If the unexpected error looks like a rate limit, don't block
  if (isRateLimited(message)) {
    process.exit(0);
  }
  block(`PR readiness check failed unexpectedly: ${message}. Fix the issue and retry.`);
}
