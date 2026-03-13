#!/usr/bin/env bash
# PR Readiness Check — Stop Hook
#
# This script runs as a Claude Code Stop hook. It prevents the agent from
# stopping if the current branch has an open PR that isn't ready to merge.
#
# Exit codes:
#   0 — Allow stop (no PR, or PR is ready)
#   2 — Block stop (PR has issues; message on stderr tells agent what to fix)
#
# Checks performed:
#   1. Merge conflicts (PR mergeable state)
#   2. CI status (all required checks passing)
#   3. Unresolved Copilot review threads
#
# Fail-closed: if any check cannot be performed (gh not installed, auth
# failure, network issue), the hook blocks and tells the agent to fix it.

set -euo pipefail

# Check that gh CLI is available
if ! command -v gh &>/dev/null; then
  echo "gh CLI is not installed. Install it to enable PR readiness checks." >&2
  exit 2
fi

# Verify gh auth — fail closed if not authenticated
if ! gh auth status &>/dev/null; then
  echo "gh CLI is not authenticated. Run: gh auth login" >&2
  exit 2
fi

# Check if a PR exists on this branch. gh pr view exits non-zero if no PR
# exists. We distinguish "no PR" (allow stop) from "query failed" (block).
PR_OUTPUT=$(gh pr view --json number --jq '.number' 2>&1) && PR_NUMBER="$PR_OUTPUT" || {
  # gh pr view failed — check if it's "no PR" vs a real error
  if echo "$PR_OUTPUT" | grep -qi "no pull requests found\|no open pull requests"; then
    exit 0
  fi
  echo "Failed to query PR status: $PR_OUTPUT. Fix gh auth or network, then retry." >&2
  exit 2
}

if [ -z "$PR_NUMBER" ]; then
  exit 0
fi

OWNER=$(gh repo view --json owner --jq '.owner.login') || {
  echo "Failed to determine repo owner. Ensure gh is authenticated." >&2
  exit 2
}
REPO=$(gh repo view --json name --jq '.name') || {
  echo "Failed to determine repo name. Ensure gh is authenticated." >&2
  exit 2
}

ISSUES=""

# ── Check 1: Merge conflicts ──────────────────────────────────────
MERGEABLE=$(gh pr view "$PR_NUMBER" --json mergeable --jq '.mergeable') || {
  ISSUES="${ISSUES}\n- Could not check merge status for PR #${PR_NUMBER}. Ensure gh is authenticated and retry."
  MERGEABLE=""
}
if [ "$MERGEABLE" = "CONFLICTING" ]; then
  ISSUES="${ISSUES}\n- PR #${PR_NUMBER} has MERGE CONFLICTS. Run: git fetch origin && git merge origin/main (NEVER rebase), resolve conflicts, commit, and push."
fi

# ── Check 2: CI status ────────────────────────────────────────────
CI_STATE=$(gh pr view "$PR_NUMBER" --json statusCheckRollup --jq '
  [.statusCheckRollup[] | .conclusion // .status] |
  if any(. == "FAILURE" or . == "ERROR" or . == "TIMED_OUT" or . == "CANCELLED" or . == "ACTION_REQUIRED" or . == "STALE" or . == "STARTUP_FAILURE") then "FAILING"
  elif any(. == "PENDING" or . == "QUEUED" or . == "IN_PROGRESS" or . == "EXPECTED" or . == null) then "PENDING"
  else "PASSING"
  end
') || {
  ISSUES="${ISSUES}\n- Could not check CI status for PR #${PR_NUMBER}. Ensure gh is authenticated and retry."
  CI_STATE="UNKNOWN"
}

if [ "$CI_STATE" = "FAILING" ]; then
  ISSUES="${ISSUES}\n- PR #${PR_NUMBER} has FAILING CI checks. Read the failed log with: gh run view <RUN_ID> --log-failed, fix the issue, commit, and push."
elif [ "$CI_STATE" = "PENDING" ]; then
  ISSUES="${ISSUES}\n- PR #${PR_NUMBER} CI checks are still RUNNING. Wait for them to complete: gh pr checks ${PR_NUMBER} --watch --fail-fast"
elif [ "$CI_STATE" = "UNKNOWN" ]; then
  ISSUES="${ISSUES}\n- PR #${PR_NUMBER} CI status could not be determined. Check gh auth and network connectivity."
fi

# ── Check 3: Unresolved Copilot review threads ────────────────────
COPILOT_THREADS=$(gh api graphql -f query='
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          comments(last: 1) {
            nodes {
              author { login }
            }
          }
        }
      }
    }
  }
}' -f owner="$OWNER" -f repo="$REPO" -F pr="$PR_NUMBER" --jq '
  [.data.repository.pullRequest.reviewThreads.nodes[] |
   select(.isResolved == false and
          .comments.nodes[0].author.login == "copilot-pull-request-reviewer")] |
   length
') || {
  ISSUES="${ISSUES}\n- Could not check Copilot review threads for PR #${PR_NUMBER}. Ensure gh has the required scopes (read:discussion) and retry."
  COPILOT_THREADS="0"
}

if [ "$COPILOT_THREADS" != "0" ] && [ "$COPILOT_THREADS" -gt 0 ] 2>/dev/null; then
  ISSUES="${ISSUES}\n- PR #${PR_NUMBER} has ${COPILOT_THREADS} unresolved Copilot review thread(s). For each: read the suggestion, fix the code or dismiss with explanation, reply to the comment, and resolve the thread."
fi

# ── Decision ──────────────────────────────────────────────────────
if [ -n "$ISSUES" ]; then
  echo -e "PR #${PR_NUMBER} is NOT ready. You must fix these issues before stopping:\n${ISSUES}\n\nAfter fixing, commit and push, then wait for CI and Copilot review to complete." >&2
  exit 2
fi

exit 0
