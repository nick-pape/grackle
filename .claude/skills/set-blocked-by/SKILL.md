---
name: set-blocked-by
description: Set or remove a GitHub blocked-by relationship between issues. Run with /set-blocked-by <blocked#> <blocker#> or /set-blocked-by remove <blocked#> <blocker#>.
---

# Set Blocked-By — GitHub Issue Dependency Relationships

Manages blocked-by (dependency) relationships between GitHub issues using the GraphQL API.

```
REPO_OWNER="nick-pape"
REPO_NAME="grackle"
```

## Usage

- `/set-blocked-by <blocked#> <blocker#>` — mark issue as blocked by another
- `/set-blocked-by remove <blocked#> <blocker#>` — remove the blocked-by relationship

## Step 1: Get Node IDs

Fetch node IDs for both issues:

```bash
gh api graphql -f query='
  query($owner: String!, $name: String!, $blocked: Int!, $blocker: Int!) {
    repository(owner: $owner, name: $name) {
      blocked: issue(number: $blocked) { id title }
      blocker: issue(number: $blocker) { id title }
    }
  }
' -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F blocked=<BLOCKED_NUMBER> -F blocker=<BLOCKER_NUMBER>
```

## Step 2: Mutate

### Add blocked-by

```bash
gh api graphql -f query='mutation {
  addBlockedBy(input: {
    issueId: "<BLOCKED_NODE_ID>",
    blockingIssueId: "<BLOCKER_NODE_ID>"
  }) { issue { number title } }
}'
```

### Remove blocked-by

```bash
gh api graphql -f query='mutation {
  removeBlockedBy(input: {
    issueId: "<BLOCKED_NODE_ID>",
    blockingIssueId: "<BLOCKER_NODE_ID>"
  }) { issue { number title } }
}'
```

**Field names** (easy to mix up):
- `issueId` = the issue that **is blocked**
- `blockingIssueId` = the issue that **is blocking** it

## Step 3: Confirm

Report what was done: "Marked #blocked as blocked by #blocker" or "Removed blocked-by relationship between #blocked and #blocker."
