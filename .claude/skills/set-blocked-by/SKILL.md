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
gh api graphql -f query='{ repository(owner: "'"$REPO_OWNER"'", name: "'"$REPO_NAME"'") {
  blocked: issue(number: <BLOCKED_NUMBER>) { id title }
  blocker: issue(number: <BLOCKER_NUMBER>) { id title }
} }'
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
