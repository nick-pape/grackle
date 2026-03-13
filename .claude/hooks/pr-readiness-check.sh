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

set -euo pipefail

# If no PR exists on this branch, allow stop
PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null) || true
if [ -z "$PR_NUMBER" ]; then
  exit 0
fi

OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO=$(gh repo view --json name --jq '.name')

ISSUES=""

# ── Check 1: Merge conflicts ──────────────────────────────────────
MERGEABLE=$(gh pr view "$PR_NUMBER" --json mergeable --jq '.mergeable' 2>/dev/null) || true
if [ "$MERGEABLE" = "CONFLICTING" ]; then
  ISSUES="${ISSUES}\n- PR #${PR_NUMBER} has MERGE CONFLICTS. Run: git fetch origin && git merge origin/main (NEVER rebase), resolve conflicts, commit, and push."
fi

# ── Check 2: CI status ────────────────────────────────────────────
# Get the rollup status of all checks
CI_STATE=$(gh pr view "$PR_NUMBER" --json statusCheckRollup --jq '
  [.statusCheckRollup[] | .conclusion // .status] |
  if any(. == "FAILURE" or . == "ERROR" or . == "TIMED_OUT") then "FAILING"
  elif any(. == "PENDING" or . == "QUEUED" or . == "IN_PROGRESS" or . == "EXPECTED" or . == null) then "PENDING"
  else "PASSING"
  end
' 2>/dev/null) || CI_STATE="UNKNOWN"

if [ "$CI_STATE" = "FAILING" ]; then
  ISSUES="${ISSUES}\n- PR #${PR_NUMBER} has FAILING CI checks. Read the failed log with: gh run view <RUN_ID> --log-failed, fix the issue, commit, and push."
elif [ "$CI_STATE" = "PENDING" ]; then
  ISSUES="${ISSUES}\n- PR #${PR_NUMBER} CI checks are still RUNNING. Wait for them to complete: gh pr checks ${PR_NUMBER} --watch --fail-fast"
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
   select(.isResolved == false and .isOutdated == false and
          .comments.nodes[0].author.login == "copilot-pull-request-reviewer")] |
   length
' 2>/dev/null) || COPILOT_THREADS="0"

if [ "$COPILOT_THREADS" != "0" ] && [ "$COPILOT_THREADS" -gt 0 ] 2>/dev/null; then
  ISSUES="${ISSUES}\n- PR #${PR_NUMBER} has ${COPILOT_THREADS} unresolved Copilot review thread(s). For each: read the suggestion, fix the code or dismiss with explanation, reply to the comment, and resolve the thread."
fi

# ── Decision ──────────────────────────────────────────────────────
if [ -n "$ISSUES" ]; then
  echo -e "PR #${PR_NUMBER} is NOT ready. You must fix these issues before stopping:\n${ISSUES}\n\nAfter fixing, commit and push, then wait for CI and Copilot review to complete." >&2
  exit 2
fi

exit 0
