/**
 * PR Readiness Check — Stop Hook
 *
 * Prevents the agent from stopping if the current branch has an open PR that
 * isn't ready to merge. Instead of telling the agent to wait (which burns
 * tokens), the hook itself polls silently until something is actionable.
 *
 * Exit codes:
 *   0 — Allow stop (no PR, PR is ready, or rate-limited)
 *   2 — Block stop (message on stderr tells agent what to fix)
 *
 * State machine (CI x Copilot):
 *   HAS_COMMENTS (any CI)  → block: "fix comments" (CI restarts after push)
 *   FAILING (no comments)  → block: "fix CI"
 *   PASSING + CLEAN        → allow stop
 *   anything pending       → poll silently until actionable or timeout
 *
 * Merge conflicts short-circuit everything (block immediately).
 */

import { execSync } from "node:child_process";

// ── Configuration ────────────────────────────────────────────────────────────

/** Milliseconds between poll iterations. */
const POLL_INTERVAL_MS = 30_000;

/** Maximum total poll time before giving up (~9 min, leaves buffer for 10-min hook timeout). */
const MAX_POLL_MS = 9 * 60 * 1000;

/**
 * After CI passes but Copilot hasn't reviewed yet, wait at most this long
 * before assuming Copilot is clean / not configured.
 */
const COPILOT_GRACE_MS = 3 * 60 * 1000;

const COPILOT_LOGIN = "copilot-pull-request-reviewer";

const FAILING_CONCLUSIONS = new Set([
  "FAILURE", "ERROR", "TIMED_OUT", "CANCELLED",
  "ACTION_REQUIRED", "STALE", "STARTUP_FAILURE",
]);

const PENDING_STATUSES = new Set([
  "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "",
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function sleep(ms) {
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);
  const end = Date.now() + ms;
  while (true) {
    const remaining = end - Date.now();
    if (remaining <= 0) {
      break;
    }
    Atomics.wait(int32, 0, 0, Math.min(remaining, 0x7fffffff));
  }
}

function isRateLimited(text) {
  return /rate limit/i.test(text) || /API rate limit exceeded/i.test(text);
}

function getOwnerRepo() {
  const result = run("git remote get-url origin");
  if (!result.stdout) {
    return null;
  }
  const match = result.stdout.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!match) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

// ── GraphQL query ────────────────────────────────────────────────────────────

const GRAPHQL_QUERY = `query($owner: String!, $repo: String!, $branch: String!) {
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
                      name
                      conclusion
                      status
                    }
                    ... on StatusContext {
                      context
                      state
                    }
                  }
                }
              }
            }
          }
        }
        reviews(first: 50) {
          nodes {
            author { login }
            state
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
}`;

// ── PR state query + evaluation ──────────────────────────────────────────────

/**
 * Query GitHub and return a structured state object, or null on rate-limit.
 * Calls block() on hard errors (auth, network, parse).
 */
function queryPrState(owner, repo, branch) {
  const payload = JSON.stringify({
    query: GRAPHQL_QUERY,
    variables: { owner, repo, branch },
  });

  const result = run("gh api graphql --input -", { input: payload });

  if (!result.stdout) {
    const output = result.stderr || "";
    if (isRateLimited(output)) {
      return null; // caller should allow stop
    }
    if (/authentication|auth|login|credentials/i.test(output)) {
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

  if (data.errors?.some((e) => /rate limit/i.test(e.message || ""))) {
    return null;
  }

  if (data.errors?.length > 0 || !data.data?.repository?.pullRequests) {
    const errorMessage = data.errors?.map((e) => e.message).join(", ") || "unexpected response shape";
    block(`GitHub API error: ${errorMessage}. Check gh auth and retry.`);
  }

  const prNodes = data.data.repository.pullRequests.nodes || [];
  if (prNodes.length === 0) {
    return { noPr: true };
  }

  const pr = prNodes[0];

  // ── CI state ─────────────────────────────────────────────────────
  const commitNode = pr.commits?.nodes?.[0]?.commit;
  const contextsConnection = commitNode?.statusCheckRollup?.contexts;
  const checkContexts = contextsConnection?.nodes || [];
  const checksHasNextPage = contextsConnection?.pageInfo?.hasNextPage || false;

  let ciState;
  let failingChecks = [];
  if (checkContexts.length === 0) {
    ciState = "PENDING";
  } else {
    for (const c of checkContexts) {
      const status = c.conclusion || c.status || c.state || "";
      if (FAILING_CONCLUSIONS.has(status)) {
        failingChecks.push(c.name || c.context || "unknown");
      }
    }
    if (failingChecks.length > 0) {
      ciState = "FAILING";
    } else if (checkContexts.some((c) => PENDING_STATUSES.has(c.conclusion || c.status || c.state || ""))) {
      ciState = "PENDING";
    } else if (checksHasNextPage) {
      ciState = "PENDING";
    } else {
      ciState = "PASSING";
    }
  }

  // ── Copilot state ────────────────────────────────────────────────
  const threads = pr.reviewThreads?.nodes || [];
  const threadsHasNextPage = pr.reviewThreads?.pageInfo?.hasNextPage || false;
  const unresolvedCopilotThreads = threads.filter(
    (t) => !t.isResolved && t.comments?.nodes?.[0]?.author?.login === COPILOT_LOGIN
  );

  const reviews = pr.reviews?.nodes || [];
  const copilotHasReviewed = reviews.some((r) => r.author?.login === COPILOT_LOGIN);

  let copilotState;
  if (unresolvedCopilotThreads.length > 0) {
    copilotState = "HAS_COMMENTS";
  } else if (threadsHasNextPage) {
    // Can't see all threads — there may be unresolved Copilot threads on later pages.
    // Treat as HAS_COMMENTS to be safe (fail-closed).
    copilotState = "HAS_COMMENTS";
  } else if (copilotHasReviewed) {
    copilotState = "CLEAN";
  } else {
    copilotState = "PENDING";
  }

  return {
    noPr: false,
    prNumber: pr.number,
    prState: pr.state,
    mergeable: pr.mergeable,
    ciState,
    failingChecks,
    copilotState,
    unresolvedCount: unresolvedCopilotThreads.length,
    threadsHasNextPage,
  };
}

/**
 * Evaluate the PR state and return an action:
 *   { action: "allow" }
 *   { action: "block", message: string }
 *   { action: "poll" }   — nothing actionable yet, keep waiting
 */
function evaluate(state) {
  if (!state || state.noPr) {
    return { action: "allow" };
  }

  const { prNumber, prState, mergeable, ciState, failingChecks, copilotState, unresolvedCount, threadsHasNextPage } = state;

  // PR already merged or closed → tell agent to clean up
  if (prState === "MERGED" || prState === "CLOSED") {
    const worktreeCheck = run("git rev-parse --git-common-dir");
    const gitDir = run("git rev-parse --git-dir");
    const isWorktree = worktreeCheck.stdout && gitDir.stdout && worktreeCheck.stdout !== gitDir.stdout;

    if (isWorktree) {
      return {
        action: "block",
        message:
          `PR #${prNumber} is already ${prState}. Clean up the worktree:\n` +
          `  Call ExitWorktree({ action: "remove" }) to delete the worktree and return to the main repo.`,
      };
    }
    return {
      action: "block",
      message:
        `PR #${prNumber} is already ${prState}. Switch back to main and pull:\n` +
        `  git checkout main && git pull\n\n` +
        `This will clear the stale branch context so the hook passes.`,
    };
  }

  // Merge conflicts — always block immediately
  if (mergeable === "CONFLICTING") {
    return {
      action: "block",
      message: `PR #${prNumber} has MERGE CONFLICTS. Run: git fetch origin && git merge origin/main (NEVER rebase), resolve conflicts, commit, and push.`,
    };
  }

  // Priority 1: Copilot comments — always fix these first (CI restarts after push)
  if (copilotState === "HAS_COMMENTS") {
    let countNote;
    if (threadsHasNextPage && unresolvedCount === 0) {
      countNote = "possible unresolved";
    } else if (threadsHasNextPage) {
      countNote = `${unresolvedCount}+`;
    } else {
      countNote = String(unresolvedCount);
    }
    return {
      action: "block",
      message:
        `PR #${prNumber} — Copilot left ${countNote} comment(s). Address each one and push.\n` +
        `CI will restart after your push — don't wait for the current run.\n` +
        (threadsHasNextPage ? `(PR has >100 review threads; check GitHub for the full list.)\n` : ""),
    };
  }

  // Priority 2: CI failing (no Copilot comments)
  if (ciState === "FAILING") {
    const checkNames = failingChecks.length > 0 ? ` (${failingChecks.join(", ")})` : "";
    return {
      action: "block",
      message: `PR #${prNumber} — CI is failing${checkNames}. Read the logs with: gh run view --log-failed\nFix the issue and push.`,
    };
  }

  // Merge status unknown — treat as poll-worthy (GitHub is still computing)
  if (mergeable === "UNKNOWN" || !mergeable) {
    return { action: "poll" };
  }

  // Both passing/clean → allow stop
  if (ciState === "PASSING" && (copilotState === "CLEAN" || copilotState === "PENDING")) {
    // If Copilot is pending but CI passed, we handle this in the poll loop
    // with a grace period. But if we're in the instant-check path, we need
    // to return "poll" so the grace period logic kicks in.
    if (copilotState === "PENDING") {
      return { action: "poll" };
    }
    return { action: "allow" };
  }

  // Anything else is pending — poll
  return { action: "poll" };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  // Check that gh CLI is available
  const ghVersion = run("gh --version");
  if (!ghVersion.stdout) {
    block("gh CLI is not installed. Install it to enable PR readiness checks.");
  }

  // Get current branch name
  const branchResult = run("git branch --show-current");
  if (!branchResult.stdout) {
    process.exit(0); // Detached HEAD — nothing to check
  }
  const branch = branchResult.stdout;

  // Parse owner/repo from git remote
  const ownerRepo = getOwnerRepo();
  if (!ownerRepo) {
    block("Could not parse owner/repo from git remote. Ensure the remote URL is set.");
  }
  const { owner, repo } = ownerRepo;

  // ── Initial check ────────────────────────────────────────────────
  const initialState = queryPrState(owner, repo, branch);
  if (!initialState) {
    process.exit(0); // Rate-limited
  }

  const initialResult = evaluate(initialState);
  if (initialResult.action === "allow") {
    process.exit(0);
  }
  if (initialResult.action === "block") {
    block(initialResult.message);
  }

  // ── Poll loop (action === "poll") ────────────────────────────────
  const pollStart = Date.now();
  let ciPassedAt = null; // Track when CI first passed (for Copilot grace period)

  while (Date.now() - pollStart < MAX_POLL_MS) {
    sleep(POLL_INTERVAL_MS);

    const state = queryPrState(owner, repo, branch);
    if (!state) {
      process.exit(0); // Rate-limited — let agent stop
    }

    const result = evaluate(state);

    if (result.action === "allow") {
      process.exit(0);
    }
    if (result.action === "block") {
      block(result.message);
    }

    // Still polling — check Copilot grace period
    if (state.ciState === "PASSING" && state.copilotState === "PENDING") {
      if (!ciPassedAt) {
        ciPassedAt = Date.now();
      }
      if (Date.now() - ciPassedAt >= COPILOT_GRACE_MS) {
        // CI passed and Copilot hasn't reviewed after grace period —
        // assume Copilot is clean or not configured, but only if
        // mergeability is known to be non-conflicting.
        if (state.mergeable === "MERGEABLE") {
          process.exit(0);
        }
      }
    } else {
      // CI went back to pending (new push?) or Copilot showed up — reset grace timer
      ciPassedAt = null;
    }
  }

  // ── Timeout ──────────────────────────────────────────────────────
  const finalState = queryPrState(owner, repo, branch);
  if (!finalState || finalState.noPr) {
    process.exit(0);
  }

  const ciLabel = finalState.ciState || "UNKNOWN";
  const copilotLabel = finalState.copilotState || "UNKNOWN";
  block(
    `PR #${finalState.prNumber} — still waiting after ${Math.round((Date.now() - pollStart) / 60000)} min ` +
    `(CI: ${ciLabel}, Copilot: ${copilotLabel}).\n` +
    `The hook will resume checking on your next stop attempt.`
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (isRateLimited(message)) {
    process.exit(0);
  }
  block(`PR readiness check failed unexpectedly: ${message}. Fix the issue and retry.`);
}
