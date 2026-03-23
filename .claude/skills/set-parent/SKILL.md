---
name: set-parent
description: Set or remove a GitHub sub-issue (parent/child) relationship. Run with /set-parent <child> <parent> or /set-parent remove <child> <parent>.
---

# Set Parent — GitHub Sub-Issue Relationships

Manages parent/child (sub-issue) relationships between GitHub issues using the GraphQL API.

```
REPO_OWNER="nick-pape"
REPO_NAME="grackle"
```

## Usage

- `/set-parent <child#> <parent#>` — make child a sub-issue of parent
- `/set-parent remove <child#> <parent#>` — remove the sub-issue relationship

## Step 1: Get Node IDs

Fetch node IDs for both issues:

```bash
gh api graphql -f query='{ repository(owner: "'"$REPO_OWNER"'", name: "'"$REPO_NAME"'") {
  parent: issue(number: <PARENT_NUMBER>) { id title }
  child: issue(number: <CHILD_NUMBER>) { id title }
} }'
```

## Step 2: Mutate

### Add sub-issue

```bash
gh api graphql -f query='mutation {
  addSubIssue(input: {
    issueId: "<PARENT_NODE_ID>",
    subIssueId: "<CHILD_NODE_ID>"
  }) { issue { number title } subIssue { number title } }
}'
```

### Remove sub-issue

```bash
gh api graphql -f query='mutation {
  removeSubIssue(input: {
    issueId: "<PARENT_NODE_ID>",
    subIssueId: "<CHILD_NODE_ID>"
  }) { issue { number title } subIssue { number title } }
}'
```

**Field names** (easy to mix up):
- `issueId` = the **parent**
- `subIssueId` = the **child**

## Step 3: Confirm

Report what was done: "Made #child a sub-issue of #parent" or "Removed #child from #parent's sub-issues."
