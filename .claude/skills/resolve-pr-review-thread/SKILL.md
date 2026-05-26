---
name: resolve-pr-review-thread
description: Resolve unresolved PR review threads using the GraphQL API. Run with /resolve-pr-review-thread or /resolve-pr-review-thread <PR_NUMBER>.
---

# Resolve PR Review Thread

Resolve unresolved PR review threads (Copilot review comments) using the GraphQL `resolveReviewThread` mutation.

## Usage

```bash
/resolve-pr-review-thread [PR_NUMBER]
```

If no PR number is provided, detect from the current branch.

## Step 1: Get PR Details

```bash
PR_NUMBER=<detected or provided PR number>
OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO=$(gh repo view --json name --jq '.name')
```

## Step 2: Fetch Unresolved Review Threads

Use the GraphQL API to fetch all unresolved review threads.

**Important**: On Windows (MSYS2/Git Bash), `$` characters in `gh api graphql -f query='...'` are unreliably handled by the shell. Always use Node.js with `gh api -X POST /graphql --input -` to pipe the GraphQL query via stdin:

```javascript
node -e "
const {execSync} = require('child_process');
const body = JSON.stringify({
  query: 'query(\x24owner: String!, \x24repo: String!, \x24pr: Int!) { repository(owner: \x24owner, name: \x24repo) { pullRequest(number: \x24pr) { reviewThreads(first: 100) { nodes { id isResolved isOutdated path line startLine comments(last: 1) { nodes { id author { login } body createdAt } } } } } } }',
  variables: {owner: '$OWNER', repo: '$REPO', pr: $PR_NUMBER}
});
console.log(execSync('gh api -X POST /graphql --input -', {input: body, encoding: 'utf-8'}));
"
```

## Step 3: Filter to Unresolved Threads

Select threads where:
- `isResolved` is `false`
- The comment author matches the target (e.g. `copilot-pull-request-reviewer` for Copilot threads, or `nick-pape` for own threads)

## Step 4: Resolve Each Thread

For each unresolved thread, use the GraphQL `resolveReviewThread` mutation:

```javascript
node -e "
const {execSync} = require('child_process');
const body = JSON.stringify({
  query: 'mutation(\x24threadId: ID!) { resolveReviewThread(input: {threadId: \x24threadId}) { thread { isResolved } } }',
  variables: {threadId: 'THREAD_NODE_ID'}
});
console.log(execSync('gh api -X POST /graphql --input -', {input: body, encoding: 'utf-8'}));
"
```

Where `THREAD_NODE_ID` comes from the GraphQL query result (the `id` field of each thread node, e.g. `PRRT_kwDORVQfCc6E2NBI`).

## Important Notes

- **Reply before resolving** — always reply to a thread before resolving it (use the `respond-to-pr-review-thread` skill first)
- **Thread IDs** — the GraphQL query returns `id` as the node_id (PRRT_...), NOT the REST numeric ID. Use this directly in the mutation.
- **No force push** — never force-push, even if it seems easier
- **CLAUDE.md compliance** — follow project conventions when making code changes alongside resolutions
