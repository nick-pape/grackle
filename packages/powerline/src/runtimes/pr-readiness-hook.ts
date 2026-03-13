import { execSync } from "node:child_process";
import { logger } from "../logger.js";

/** Timeout in seconds for the PR readiness Stop hook. */
const HOOK_TIMEOUT_SECONDS: number = 120;

/**
 * Check whether the current branch has a PR that is ready (no merge conflicts,
 * CI passing, no unresolved Copilot threads).
 *
 * Returns `{ ready: true }` if there is no PR or the PR is ready.
 * Returns `{ ready: false, reason: string }` with actionable instructions otherwise.
 */
function checkPrReadiness(cwd?: string): { ready: boolean; reason?: string } {
  const execOpts = { encoding: "utf-8" as const, cwd, timeout: 30_000 };

  // Check if a PR exists on this branch
  let prNumber: string;
  try {
    prNumber = execSync(
      "gh pr view --json number --jq .number",
      execOpts,
    ).trim();
  } catch {
    // No PR on this branch — allow stop
    return { ready: true };
  }

  if (!prNumber) {
    return { ready: true };
  }

  const issues: string[] = [];

  // Check merge conflicts
  try {
    const mergeable = execSync(
      `gh pr view ${prNumber} --json mergeable --jq .mergeable`,
      execOpts,
    ).trim();
    if (mergeable === "CONFLICTING") {
      issues.push(
        `PR #${prNumber} has MERGE CONFLICTS. Run: git fetch origin && git merge origin/main (NEVER rebase), resolve conflicts, commit, and push.`,
      );
    }
  } catch (err) {
    logger.warn({ err }, "Failed to check PR mergeable state");
  }

  // Check CI status
  try {
    const ciState = execSync(
      `gh pr view ${prNumber} --json statusCheckRollup --jq '[.statusCheckRollup[] | .conclusion // .status] | if any(. == "FAILURE" or . == "ERROR" or . == "TIMED_OUT") then "FAILING" elif any(. == "PENDING" or . == "QUEUED" or . == "IN_PROGRESS" or . == "EXPECTED" or . == null) then "PENDING" else "PASSING" end'`,
      execOpts,
    ).trim();
    if (ciState === "FAILING") {
      issues.push(
        `PR #${prNumber} has FAILING CI checks. Read the failed log with: gh run view <RUN_ID> --log-failed, fix the issue, commit, and push.`,
      );
    } else if (ciState === "PENDING") {
      issues.push(
        `PR #${prNumber} CI checks are still RUNNING. Wait for them to complete: gh pr checks ${prNumber} --watch --fail-fast`,
      );
    }
  } catch (err) {
    logger.warn({ err }, "Failed to check PR CI status");
  }

  // Check unresolved Copilot review threads
  try {
    const owner = execSync(
      "gh repo view --json owner --jq .owner.login",
      execOpts,
    ).trim();
    const repo = execSync(
      "gh repo view --json name --jq .name",
      execOpts,
    ).trim();
    const copilotCount = execSync(
      `gh api graphql -f query='query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(first:100){nodes{isResolved isOutdated comments(last:1){nodes{author{login}}}}}}}}' -f owner="${owner}" -f repo="${repo}" -F pr="${prNumber}" --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false and .isOutdated == false and .comments.nodes[0].author.login == "copilot-pull-request-reviewer")] | length'`,
      execOpts,
    ).trim();
    const count = parseInt(copilotCount, 10);
    if (count > 0) {
      issues.push(
        `PR #${prNumber} has ${count} unresolved Copilot review thread(s). For each: read the suggestion, fix the code or dismiss with explanation, reply to the comment, and resolve the thread.`,
      );
    }
  } catch (err) {
    logger.warn({ err }, "Failed to check Copilot review threads");
  }

  if (issues.length > 0) {
    const reason = `PR #${prNumber} is NOT ready. Fix these issues before stopping:\n- ${issues.join("\n- ")}\n\nAfter fixing, commit and push, then wait for CI and Copilot review to complete.`;
    return { ready: false, reason };
  }

  return { ready: true };
}

/**
 * Build an SDK-compatible Stop hook that blocks the agent from stopping
 * if the current branch has a PR that isn't ready to merge.
 *
 * Returns a hooks object suitable for passing to the Claude Agent SDK's
 * `options.hooks` field.
 */
export function buildPrReadinessHook(cwd?: string): Record<string, unknown> {
  return {
    Stop: [
      {
        hooks: [
          async (input: Record<string, unknown>) => {
            // Prevent infinite loops: if the stop hook is already active
            // (meaning we blocked once and Claude is trying to stop again),
            // allow it to stop this time.
            if (input.stop_hook_active) {
              return { continue: true };
            }

            const result = checkPrReadiness(cwd);
            if (!result.ready) {
              logger.info(
                { reason: result.reason },
                "PR readiness Stop hook: blocking stop",
              );
              return {
                decision: "block" as const,
                reason: result.reason,
              };
            }

            return { continue: true };
          },
        ],
        timeout: HOOK_TIMEOUT_SECONDS,
      },
    ],
  };
}
