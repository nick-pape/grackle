---
name: backlog-prioritize
description: Fetch all approved-for-grackle issues, filter out closed and already-in-progress ones, and suggest a prioritized ordering. Run with /backlog-prioritize.
---

# Backlog Prioritize — Suggested Issue Ordering

This skill fetches all open `approved-for-grackle` issues, filters out ones that already have a PR, and outputs a suggested priority ordering with rationale.

```
REPO="nick-pape/grackle"
```

## Step 1: Fetch All Approved Issues

```bash
gh issue list -R $REPO --label "approved-for-grackle" --state open --limit 100 --json number,title,labels,body
```

## Step 2: Find Issues That Already Have PRs

Check for open PRs that reference these issues (via branch name or body):

```bash
gh pr list -R $REPO --state open --limit 100 --json number,title,body,headRefName
```

Cross-reference: if a PR's body contains `Closes #<N>` / `Fixes #<N>`, or its branch name contains the issue number (e.g., `nick-pape/295-unified`), that issue is already in progress. Exclude it from the ordering.

## Step 3: Classify and Sort

For each remaining issue, extract:
- **Priority label**: `priority:critical` > `priority:high` > (unlabeled) > `priority:low`
- **Type**: `bug` > `feature` > `refactor` (bugs first — they degrade existing functionality)
- **Domain labels**: `orchestration`, `web`, `server`, `powerline`, `cli`
- **Dependencies**: Read each issue body for references to other issues. If issue A mentions "depends on #B" or "requires #B first" or "after #B", A should come after B.

Sort by:
1. Priority label (critical first)
2. Type (bugs before features before refactors)
3. Dependency ordering (blockers before dependents)
4. Issue number (older issues first, as a tiebreaker)

## Step 4: Identify Parallelizable Work

Group issues by domain (web, server, powerline, etc.). Issues in different domains with no dependency relationship can be worked on in parallel by different agents/environments.

## Step 5: Output the Ordering

Present an ordered report using the following Markdown structure:

```
## Suggested Backlog Order

### Priority Tier 1 (Critical)
| # | Issue | Type | Domain | Why here |
|---|-------|------|--------|----------|
| 1 | #NNN — Title | feature | server | Critical priority, no dependencies |

### Priority Tier 2 (High)
...

### Priority Tier 3 (Normal)
...

### Parallelization Opportunities
- **Web track**: #X, #Y, #Z (can run concurrently with server track)
- **Server/orchestration track**: #A, #B, #C

### Excluded (already have PRs)
- #NNN — Title (PR #MMM)
```

For each issue, the "Why here" column should briefly explain the ordering rationale (dependency, priority, domain grouping).
