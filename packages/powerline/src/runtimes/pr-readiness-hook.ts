import { execSync } from "node:child_process";
import { logger } from "../logger.js";

/** Timeout in seconds for the PR readiness Stop hook. Allows for multiple sequential gh CLI calls. */
const HOOK_TIMEOUT_SECONDS: number = 180;

/** Timeout in milliseconds for individual gh CLI commands. */
const EXEC_TIMEOUT_MS: number = 30_000;

/**
 * Check whether the current branch has a PR that is ready (no merge conflicts,
 * CI passing, no unresolved Copilot threads).
 *
 * Fail-closed: if any check cannot be performed (gh not available, auth failure,
 * network issue), the hook blocks with actionable instructions.
 *
 * Returns `{ ready: true }` if there is no PR or the PR is ready.
 * Returns `{ ready: false, reason: string }` with actionable instructions otherwise.
 */
export function checkPrReadiness(cwd?: string): { ready: boolean; reason?: string } {
  const execOpts = { encoding: "utf-8" as const, cwd, timeout: EXEC_TIMEOUT_MS };

  // Check if a PR exists on this branch. Distinguish "no PR" from "query failed".
  let prNumber: string;
  try {
    prNumber = execSync(
      "gh pr view --json number --jq .number",
      execOpts,
    ).trim();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // gh pr view exits non-zero for both "no PR" and real errors.
    // "no pull requests found" means there's genuinely no PR — allow stop.
    if (errorMsg.toLowerCase().includes("no pull requests found") || errorMsg.toLowerCase().includes("no open pull requests")) {
      return { ready: true };
    }
    // Any other error (auth failure, network, gh not installed) — fail closed.
    return {
      ready: false,
      reason: `Could not check PR status: ${errorMsg}. Ensure gh CLI is installed and authenticated.`,
    };
  }

  if (!prNumber) {
    return { ready: true };
  }

  const issues: string[] = [];

  // Check merge conflicts — fail closed on error
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
    issues.push(
      `Could not check merge status for PR #${prNumber}. Ensure gh is authenticated and retry.`,
    );
  }

  // Check CI status — fail closed on error
  try {
    const ciState = execSync(
      `gh pr view ${prNumber} --json statusCheckRollup --jq '[.statusCheckRollup[] | .conclusion // .status] | if any(. == "FAILURE" or . == "ERROR" or . == "TIMED_OUT" or . == "CANCELLED" or . == "ACTION_REQUIRED" or . == "STALE" or . == "STARTUP_FAILURE") then "FAILING" elif any(. == "PENDING" or . == "QUEUED" or . == "IN_PROGRESS" or . == "EXPECTED" or . == null) then "PENDING" else "PASSING" end'`,
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
    issues.push(
      `Could not check CI status for PR #${prNumber}. Ensure gh is authenticated and retry.`,
    );
  }

  // Check unresolved Copilot review threads — fail closed on error
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
      `gh api graphql -f query='query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(first:100){nodes{isResolved isOutdated comments(last:1){nodes{author{login}}}}}}}}' -f owner="${owner}" -f repo="${repo}" -F pr="${prNumber}" --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false and .comments.nodes[0].author.login == "copilot-pull-request-reviewer")] | length'`,
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
    issues.push(
      `Could not check Copilot review threads for PR #${prNumber}. Ensure gh has the required scopes and retry.`,
    );
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
 * `options.hooks` field. Only the Claude Code runtime supports SDK hooks;
 * other runtimes (Codex, Copilot) ignore the hooks option.
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
