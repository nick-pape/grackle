---
name: respond-to-pr-review-thread
description: Respond to unresolved PR review threads (reply to Copilot review comments). Run with /respond-to-pr-review-thread or /respond-to-pr-review-thread <PR_NUMBER>.
---

# Respond to PR Review Thread

Reply to unresolved PR review thread comments without resolving them. Useful for providing context before resolving, or for wontfix explanations.

## Usage

```bash
/respond-to-pr-review-thread [PR_NUMBER]
```

If no PR number is provided, detect from the current branch.

## Step 1: Get PR Details

```bash
PR_NUMBER=<detected or provided PR number>
OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO=$(gh repo view --json name --jq '.name')
```

## Step 2: Fetch Unresolved Review Threads

Use the GraphQL API to fetch all unresolved review threads with Copilot comments.

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

## Step 3: Filter to Actionable Threads

Select threads where:
- `isResolved` is `false`
- The comment author is `copilot-pull-request-reviewer` (or the user's own unresolved thread)

## Step 4: Reply to Each Thread

For each unresolved thread, reply using the REST API. The GraphQL `comments.nodes[0].id` is the node_id — you need to get the REST numeric ID. Use the REST comments endpoint to find matching comments:

```bash
gh api "repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments?per_page=100" --jq '.[] | select(.user.login == "Copilot") | {id, node_id}'
```

Match the GraphQL node_id to the REST node_id to get the REST numeric `id`, then reply:

```bash
gh api "repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments/$COMMENT_ID/replies" -f body="YOUR_REPLY"
```

## Important Notes

- **Reply before resolving** — always reply to a thread before resolving it
- **Thread resolution** uses a separate skill (`resolve-pr-review-thread`)
- **No force push** — never force-push, even if it seems easier
- **CLAUDE.md compliance** — follow project conventions when making code changes alongside replies
