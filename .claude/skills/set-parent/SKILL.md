---
name: set-parent
description: Set or remove a GitHub sub-issue (parent/child) relationship. Run with /set-parent <child#> <parent#> or /set-parent remove <child#> <parent#>.
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
gh api graphql -f query='
  query($owner: String!, $name: String!, $parent: Int!, $child: Int!) {
    repository(owner: $owner, name: $name) {
      parent: issue(number: $parent) { id title }
      child: issue(number: $child) { id title }
    }
  }
' -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F parent=<PARENT_NUMBER> -F child=<CHILD_NUMBER>
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
