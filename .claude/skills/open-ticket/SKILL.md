---
name: open-ticket
description: Create a new GitHub issue with proper labels and epic assignment, then write a requirements spec for it. Run with /open-ticket "<title>" or interactively.
---

# Open Ticket — Issue Creation with Spec

This skill creates a new GitHub issue with proper labels and epic assignment, then automatically runs the `/write-spec` skill to post a requirements specification as a comment.

## Step 0: Gather Information

If a title was provided as an argument, use it. Otherwise, ask the user for:
- **Title**: Short, descriptive issue title
- **Description**: What is this feature/bug/refactor? (can be brief — the spec will expand it)

```
REPO="nick-pape/grackle"
```

## Step 1: Fetch Available Labels

Fetch the repository's labels to select the right ones:

```bash
gh label list -R $REPO --limit 100 --json name --jq '.[].name'
```

## Step 2: Fetch Open Epics

Fetch the current epic issues to find the right parent:

```bash
gh issue list -R $REPO --state open --search "Epic:" --json number,title --jq '.[] | "\(.number): \(.title)"'
```

Key epics to know:
- **#270** — Epic: Orchestration (multi-agent coordination, swarming, reconciliation, escalation)
- **#272** — Epic: Web UI features (all frontend/UX work)
- **#271** — Epic: Code quality and refactoring
- **#273** — Epic: Rushstack tooling adoption (build infra)

## Step 3: Classify the Issue

Based on the title and description, determine:

### Labels (select all that apply):
- **Type**: `feature`, `bug`, `refactor`, `infra`
- **Packages**: `web`, `server`, `cli`, `powerline`, `common` (based on which packages are affected)
- **Domain**: `orchestration` (if related to multi-agent, swarming, task lifecycle, reconciliation, escalation)
- **Priority**: `priority:critical`, `priority:high`, `priority:low` (if the user specifies, otherwise omit)

### Parent Epic:
- Web/UX features → #272
- Orchestration/multi-agent → #270
- Refactoring/code quality → #271
- Build/tooling → #273
- If unclear, ask the user

## Step 4: Create the Issue

```bash
gh issue create -R $REPO \
  --title "<TITLE>" \
  --label "<LABELS>" \
  --body "$(cat <<'EOF'
## Summary
<User's description, expanded into 2-3 sentences explaining what and why>

## Related
<List any related issues discovered during classification>
EOF
)"
```

Capture the created issue number from the output URL.

## Step 5: Set GitHub Issue Relationships

GitHub has real relationship fields (sub-issues, blocked-by) accessible via GraphQL. Use these instead of markdown-only references.

### Get Issue Node IDs

Every GraphQL mutation needs node IDs, not issue numbers. Fetch them:

```bash
gh api graphql -f query='{ repository(owner: "nick-pape", name: "grackle") {
  parent: issue(number: <EPIC_NUMBER>) { id }
  child: issue(number: <NEW_ISSUE_NUMBER>) { id }
} }'
```

### Set Parent (Sub-Issue)

Makes the new issue a sub-issue of the parent epic:

```bash
gh api graphql -f query='mutation {
  addSubIssue(input: {
    issueId: "<PARENT_NODE_ID>",
    subIssueId: "<CHILD_NODE_ID>"
  }) { issue { number } }
}'
```

### Set Blocked-By (if applicable)

If the new issue depends on other issues, mark it as blocked:

```bash
gh api graphql -f query='mutation {
  addBlockedBy(input: {
    issueId: "<BLOCKED_ISSUE_NODE_ID>",
    blockingIssueId: "<BLOCKER_ISSUE_NODE_ID>"
  }) { issue { number } }
}'
```

**Field names** (these are easy to mix up):
- `addSubIssue`: `issueId` = parent, `subIssueId` = child
- `addBlockedBy`: `issueId` = the blocked issue, `blockingIssueId` = the blocker

You can batch multiple mutations in one call using aliases:

```bash
gh api graphql -f query='mutation {
  a: addSubIssue(input: { issueId: "<EPIC_ID>", subIssueId: "<ISSUE_1_ID>" }) { issue { number } }
  b: addSubIssue(input: { issueId: "<EPIC_ID>", subIssueId: "<ISSUE_2_ID>" }) { issue { number } }
}'
```

### When creating multiple related issues

If creating an epic with children, set up all relationships:
1. Create the epic issue first
2. Create all child issues
3. Fetch all node IDs in one query
4. Batch `addSubIssue` mutations for parent-child
5. Batch `addBlockedBy` mutations for dependency ordering

## Step 6: Run /write-spec

Now invoke the `/write-spec` skill on the newly created issue to research and post a detailed requirements specification:

Use the Skill tool to invoke `write-spec` with the new issue number as the argument.

## Step 7: Report

Summarize:
- Issue number and URL
- Labels applied
- Parent epic (with real sub-issue relationship)
- Blocked-by relationships (if any)
- Confirm that the requirements spec was posted
