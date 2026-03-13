/**
 * PR Readiness Check — Stop Hook
 *
 * This script runs as a Claude Code Stop hook. It prevents the agent from
 * stopping if the current branch has an open PR that isn't ready to merge.
 *
 * Exit codes:
 *   0 — Allow stop (no PR, or PR is ready)
 *   2 — Block stop (PR has issues; message on stderr tells agent what to fix)
 *
 * Checks performed:
 *   1. Merge conflicts (PR mergeable state)
 *   2. CI status (all checks passing)
 *   3. Unresolved Copilot review threads
 *
 * Fail-closed: if any check cannot be performed (gh not installed, auth
 * failure, network issue), the hook blocks and tells the agent to fix it.
 */

import { execSync } from "node:child_process";

const FAILING_CONCLUSIONS = new Set([
  "FAILURE", "ERROR", "TIMED_OUT", "CANCELLED",
  "ACTION_REQUIRED", "STALE", "STARTUP_FAILURE",
]);

const PENDING_STATUSES = new Set([
  "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "",
]);

/**
 * Run a command and return its stdout trimmed. Returns null on failure.
 */
function run(cmd, options) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], ...options }).trim();
  } catch {
    return null;
  }
}

/**
 * Run a command and parse stdout as JSON. Returns null on failure.
 */
function runJson(cmd, options) {
  const result = run(cmd, options);
  if (result === null) {
    return null;
  }
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

function block(message) {
  process.stderr.write(message + "\n");
  process.exit(2);
}

function main() {
  // Check that gh CLI is available
  if (run("gh --version") === null) {
    block("gh CLI is not installed. Install it to enable PR readiness checks.");
  }

  // Verify gh auth — fail closed if not authenticated
  if (run("gh auth status") === null) {
    block("gh CLI is not authenticated. Run: gh auth login");
  }

  // Check if a PR exists on this branch. Capture stderr from the error
  // object to distinguish "no PR" from a real failure — avoids a second call.
  let prNumber;
  try {
    const output = execSync("gh pr view --json number", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const parsed = JSON.parse(output);
    prNumber = parsed.number;
  } catch (error) {
    const output = (error.stderr || "") + (error.stdout || "");
    if (/no pull requests found|no open pull requests/i.test(output)) {
      process.exit(0);
    }
    block(`Failed to query PR status: ${output.trim()}. Fix gh auth or network, then retry.`);
  }

  if (!prNumber) {
    process.exit(0);
  }

  const repoData = runJson("gh repo view --json owner,name");
  if (!repoData) {
    block("Failed to determine repo owner/name. Ensure gh is authenticated.");
  }
  const { owner: { login: owner }, name: repo } = repoData;

  const issues = [];

  // ── Check 1: Merge conflicts ──────────────────────────────────────
  const mergeData = runJson(`gh pr view ${prNumber} --json mergeable`);
  const mergeable = mergeData?.mergeable;
  if (mergeable === "CONFLICTING") {
    issues.push(`PR #${prNumber} has MERGE CONFLICTS. Run: git fetch origin && git merge origin/main (NEVER rebase), resolve conflicts, commit, and push.`);
  } else if (mergeable === "UNKNOWN" || !mergeable) {
    issues.push(`PR #${prNumber} merge status is UNKNOWN (GitHub may still be computing). Wait a moment and retry.`);
  }

  // ── Check 2: CI status ────────────────────────────────────────────
  const ciData = runJson(`gh pr view ${prNumber} --json statusCheckRollup`);
  const checks = ciData?.statusCheckRollup || [];

  let ciState;
  if (checks.length === 0) {
    ciState = "PENDING";
  } else {
    const conclusions = checks.map((c) => c.conclusion || c.status || "");
    if (conclusions.some((c) => FAILING_CONCLUSIONS.has(c))) {
      ciState = "FAILING";
    } else if (conclusions.some((c) => PENDING_STATUSES.has(c))) {
      ciState = "PENDING";
    } else {
      ciState = "PASSING";
    }
  }

  if (ciState === "FAILING") {
    issues.push(`PR #${prNumber} has FAILING CI checks. Read the failed log with: gh run view <RUN_ID> --log-failed, fix the issue, commit, and push.`);
  } else if (ciState === "PENDING") {
    issues.push(`PR #${prNumber} CI checks are still RUNNING. Wait for them to complete: gh pr checks ${prNumber} --watch --fail-fast`);
  } else if (ciData === null) {
    issues.push(`PR #${prNumber} CI status could not be determined. Check gh auth and network connectivity.`);
  }

  // ── Check 3: Unresolved Copilot review threads ────────────────────
  const graphqlQuery = JSON.stringify({
    query: `query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
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
}`,
    variables: { owner, repo, pr: prNumber },
  });

  const graphqlResult = runJson("gh api graphql --input -", { input: graphqlQuery });

  let threadCount = 0;
  if (graphqlResult) {
    const threads = graphqlResult.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
    threadCount = threads.filter(
      (t) => !t.isResolved && t.comments?.nodes?.[0]?.author?.login === "copilot-pull-request-reviewer"
    ).length;
  }

  if (threadCount > 0) {
    issues.push(`PR #${prNumber} has ${threadCount} unresolved Copilot review thread(s). For each: read the suggestion, fix the code or dismiss with explanation, reply to the comment, and resolve the thread.`);
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

main();
