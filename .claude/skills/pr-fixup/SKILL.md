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

Store the PR number in a variable for all subsequent commands. Also fetch the repo owner/name:

```bash
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

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

## Step 3: Push

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
          comments(first: 10) {
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
}' -f owner=OWNER -f repo=REPO -F pr=PR_NUMBER
```

Replace `OWNER`, `REPO`, and `PR_NUMBER` with the actual values.

### 4c: Filter to Actionable Comments

From the response, select threads where ALL of:
- `isResolved` is `false`
- `isOutdated` is `false`
- At least one comment has `author.login` equal to `"Copilot"` (case-sensitive)
- The Copilot comment is the **last** comment in the thread (no human/bot reply after it)

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
   gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments/COMMENT_ID/replies -f body="MESSAGE"
   ```
   Where `COMMENT_ID` is the `id` (numeric REST ID) of the Copilot comment, and `MESSAGE` explains what was done.
   **Important**: The REST API needs numeric comment IDs, not GraphQL node IDs. Fetch the numeric IDs with:
   ```bash
   gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments --jq '.[] | select(.user.login == "Copilot") | {id, path, line, body}'
   ```
5. **Resolve the thread** using the GraphQL mutation with the thread's GraphQL node ID:
   ```bash
   gh api graphql -f query='
   mutation($threadId: ID!) {
     resolveReviewThread(input: {threadId: $threadId}) {
       thread { isResolved }
     }
   }' -f threadId=THREAD_NODE_ID
   ```

### 4e: Commit and Push Fixes

If any code changes were made in this round:

1. Stage all modified files (use specific file names, not `git add -A`)
2. Commit with a message like: `Address Copilot review round N: <brief summary of fixes>`
3. Push:
   ```bash
   git push
   ```
4. Go back to step 4a (the push triggers a new Copilot review)

If no code changes were made (all comments were dismissed), go to step 4f.

### 4f: Confirm Stability

After a round with zero new actionable comments, wait 30 more seconds and check again:

```bash
sleep 30
```

Re-run the GraphQL query from step 4b. If still zero unresolved Copilot threads, the review loop is complete. If new comments appeared, go back to step 4d.

## Step 5: Wait for CI

Poll CI status every 30 seconds, with a timeout of 15 minutes:

```bash
gh pr checks PR_NUMBER --watch --fail-fast
```

If `--watch` is not available, poll manually:

```bash
gh pr checks PR_NUMBER
```

Check every 30 seconds. CI is done when all required checks show a conclusion (pass or fail). If any check fails:

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
- **Copilot login**: Filter comments by `author.login == "Copilot"` (exact, case-sensitive) for GraphQL or `user.login == "Copilot"` for REST
- **Thread resolution**: Always reply BEFORE resolving — resolving without a reply looks dismissive
- **Batch commits**: Group all fixes from one review round into a single commit
- **CLAUDE.md compliance**: When fixing code, follow all project conventions in CLAUDE.md (TSDoc, full braces, no magic numbers, etc.)
- **No force push**: Never force-push, even if it seems easier. Follow the git workflow in CLAUDE.md.
- **Rush change files**: If the PR modifies publishable packages and doesn't have a change file yet, create one per CLAUDE.md instructions
