---
name: pr-fixup
description: Automated PR fixup loop — syncs with main, addresses all Copilot review comments, and waits for CI to pass. Run with /pr-fixup or /pr-fixup <PR_NUMBER>.
---

# PR Fixup — Automated Copilot Review Loop

This skill automates the full PR-readiness workflow: sync with main, address Copilot review comments in a loop, and verify CI passes.

## Step 0: Detect PR Number

If a PR number was provided as an argument, use it. Otherwise detect from the current branch:

```bash
gh pr view --json number --jq '.number'
```

If this fails, the current branch has no open PR — tell the user and stop.

Store the PR number, repo owner, and repo name for all subsequent commands:

```bash
PR_NUMBER=<detected or provided PR number>
OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO=$(gh repo view --json name --jq '.name')
```

All commands below use `$PR_NUMBER`, `$OWNER`, and `$REPO`.

## Step 1: Sync with Main

```bash
git fetch origin
git merge origin/main
```

If merge conflicts arise:
1. List the conflicted files with `git diff --name-only --diff-filter=U`
2. Read each conflicted file and resolve the conflicts intelligently
3. Stage the resolved files and commit the merge

If no conflicts, and the merge brought in new commits, the merge commit is created automatically.

## Step 2: Build Verification

Run the build to catch compile errors before pushing:

```bash
rush build
```

If the build fails, fix the errors, commit the fixes, and re-run the build. Only proceed to push once the build succeeds.

## Step 3: Manual Test and Push

Before pushing, manually test the PR's changes to catch issues early (see Step 4g for testing instructions). If the PR only touches config/docs or codespace-only code, note why testing is skipped.

```bash
git push
```

This triggers both CI and a Copilot review on the PR.

## Step 4: Copilot Review Loop

Repeat the following cycle until stable (zero new unresolved Copilot comments on two consecutive checks).

### 4a: Wait for Copilot Review

Wait 30 seconds for the Copilot review to arrive:

```bash
sleep 30
```

### 4b: Fetch Review Threads

Use the GraphQL API to fetch all review threads, filtering for unresolved ones with Copilot comments:

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          startLine
          comments(last: 1) {
            nodes {
              id
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}' -f owner="$OWNER" -f repo="$REPO" -F pr="$PR_NUMBER"
```

### 4c: Filter to Actionable Comments

From the response, select threads where ALL of:
- `isResolved` is `false`
- `isOutdated` is `false`
- The last comment (from the `comments(last: 1)` query) has `author.login` equal to `"copilot-pull-request-reviewer"`

If no threads match, the loop may be done — skip to step 4f.

### 4d: Address Each Comment

For each actionable Copilot thread:

1. **Read the file** at the path indicated by `path`, focusing on the lines around `line` (and `startLine` if present)
2. **Understand the suggestion** — Copilot comments typically suggest code improvements, bug fixes, security issues, or style changes
3. **Decide**: fix the code or dismiss with an explanation
   - **Fix**: If the suggestion is valid and improves the code, apply the fix using the Edit tool
   - **Dismiss**: If the suggestion is incorrect, not applicable, or conflicts with project conventions in CLAUDE.md, write a reply explaining why
4. **Reply** to the comment via the REST API:
   ```bash
   gh api "repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments/$COMMENT_ID/replies" -f body="MESSAGE"
   ```
   Where `COMMENT_ID` is the numeric REST ID of the Copilot comment, and `MESSAGE` explains what was done.
   **Important**: The REST API needs numeric comment IDs, not GraphQL node IDs. Fetch them with:
   ```bash
   gh api "repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments" --jq '.[] | select(.user.login == "Copilot") | {id, node_id, path, line, body}'
   ```
   To map a GraphQL thread to its REST comment ID, match the GraphQL comment's node ID (`comments.nodes[0].id`) to the `node_id` field in the REST output, then use that entry's numeric `id` as `COMMENT_ID`.
5. **Resolve the thread** using the GraphQL mutation with the thread's GraphQL node ID:
   ```bash
   gh api graphql -f query='
   mutation($threadId: ID!) {
     resolveReviewThread(input: {threadId: $threadId}) {
       thread { isResolved }
     }
   }' -f threadId=THREAD_NODE_ID
   ```

### 4e: Commit, Push, and Manually Test Fixes

If any code changes were made in this round:

1. Stage all modified files (use specific file names, not `git add -A`)
2. Commit with a message like: `Address Copilot review round N: <brief summary of fixes>`
3. **Manually test the changes** before pushing (see Step 4g below)
4. Push:
   ```bash
   git push
   ```
5. Go back to step 4a (the push triggers a new Copilot review)

If no code changes were made (all comments were dismissed), go to step 4f.

### 4g: Manual Testing

After making code changes (whether from Copilot fixes or CI fixes), manually test the affected functionality before pushing. This catches real-world issues that unit tests miss.

**Preferred: Web UI via Playwright MCP**
1. Start the Grackle server if not already running (check ports first per CLAUDE.md multi-session safety)
2. Use `mcp__playwright__browser_navigate` to open the web UI
3. Exercise the affected feature — create/edit entities, trigger the changed flow, verify the UI behaves correctly
4. Take a screenshot if the change is visual

**Fallback: CLI**
1. Start the Grackle server if not already running
2. Run the relevant `grackle` CLI commands to exercise the changed functionality
3. Verify the output matches expectations

**Skip conditions** (state explicitly if skipping):
- The change is purely internal refactoring with no observable behavior
- The change only affects codespace/remote environments that can't be tested locally
- The change is documentation or config only

### 4f: Confirm Stability

After a round with zero new actionable comments, wait 30 more seconds and check again:

```bash
sleep 30
```

Re-run the GraphQL query from step 4b. If still zero unresolved Copilot threads, the review loop is complete. If new comments appeared, go back to step 4d.

## Step 5: Wait for CI

Poll CI status with a 15-minute timeout. Use `--watch` with a timeout wrapper:

```bash
timeout 900 gh pr checks "$PR_NUMBER" --watch --fail-fast
```

Note: `timeout` returns exit code 124 on timeout, while `gh pr checks --fail-fast` returns a non-zero code on check failure. Distinguish between them — a timeout means CI is still running (report it as a timeout), while a non-124 failure means a check actually failed.

If `--watch` or `timeout` is not available, poll manually — run `gh pr checks "$PR_NUMBER"` every 30 seconds, tracking elapsed time. Stop after 15 minutes (30 iterations) and report a timeout.

CI is done when all required checks show a conclusion (pass or fail). If any check fails:

1. Read the failed log:
   ```bash
   gh run view RUN_ID --log-failed
   ```
2. Fix the issue
3. Commit and push (this restarts both CI and the Copilot review loop — go back to step 4)

## Step 6: Report

When everything is green, summarize:
- How many Copilot review rounds were needed
- How many comments were fixed vs dismissed
- CI status (pass/fail)
- Any merge conflicts that were resolved

## Important Notes

- **Repo name**: Use `gh repo view` to get the owner/repo dynamically — do not hardcode
- **Copilot identification**: Use the GraphQL comment `id` / REST `node_id` join as the source of truth when correlating comments across APIs. For filtering, GraphQL uses `author.login == "copilot-pull-request-reviewer"` and REST uses `user.login == "Copilot"`
- **Thread resolution**: Always reply BEFORE resolving — resolving without a reply looks dismissive
- **Batch commits**: Group all fixes from one review round into a single commit
- **CLAUDE.md compliance**: When fixing code, follow all project conventions in CLAUDE.md (TSDoc, full braces, no magic numbers, etc.)
- **No force push**: Never force-push, even if it seems easier. Follow the git workflow in CLAUDE.md.
- **Rush change files**: If the PR modifies publishable packages and doesn't have a change file yet, create one per CLAUDE.md instructions
