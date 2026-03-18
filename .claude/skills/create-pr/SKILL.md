---
name: create-pr
description: Create a PR with change files, screenshots, and issue linking. Run with /create-pr or /create-pr <ISSUE_NUMBER>.
---

# Create PR — Pull Request Creation Workflow

This skill creates a pull request for the current branch: syncs with main, builds, generates Rush change files if needed, captures screenshots for visual changes, and opens the PR with proper issue linking.

## Step 0: Detect Context

Determine the issue number using this priority:
1. If an argument was provided, use it as `ISSUE_NUMBER`
2. Otherwise, extract from the branch name (pattern: `<user>/<issue>-<feature>`, e.g., `nick-pape/149-agent-subtask-creation` → `ISSUE_NUMBER=149`)
3. If neither yields a number, set `ISSUE_NUMBER=""` (no issue linked — the PR will be created without a `Closes` reference)

Set variables for subsequent steps:

```bash
OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO=$(gh repo view --json name --jq '.name')
BRANCH=$(git branch --show-current)
```

If `ISSUE_NUMBER` is set, fetch the issue title for use in the PR title:

```bash
gh issue view $ISSUE_NUMBER --json title --jq '.title'
```

## Step 1: Verify Branch State

1. Ensure not on `main` — if on main, tell the user to create a feature branch and stop
2. Check for uncommitted changes (`git status --porcelain`) — if any, ask the user whether to commit or stash them
3. Check for unpushed commits (`git log @{u}..HEAD` or if no upstream, note that push is needed)
4. Check if a PR already exists for this branch:
   ```bash
   gh pr view --json number,url 2>/dev/null
   ```
   If a PR already exists, report its URL and stop. Suggest using `/pr-fixup` instead.

## Step 2: Sync with Main

```bash
git fetch origin
git merge origin/main
```

If merge conflicts arise:
1. List conflicted files with `git diff --name-only --diff-filter=U`
2. Read each conflicted file and resolve the conflicts intelligently
3. Stage the resolved files and commit the merge

## Step 3: Build Verification

```bash
rush build
```

If the build fails, fix the errors, commit the fixes, and re-run. Only proceed once the build succeeds.

## Step 4: Generate Change Files (if needed)

Run the `/rush-change` skill. It handles everything: detecting whether a change file is actually needed, distinguishing real changes from merge-commit false positives, generating the file with the correct bump type, and committing it.

## Step 5: Push Branch

```bash
git push -u origin $BRANCH
```

If already tracking a remote branch, use `git push` without `-u`.

## Step 6: Capture Screenshots (if visual changes)

Only if the diff touches `packages/web/`.

Here is a quick summary of the key steps:

**Quick summary:**
1. Start an isolated Grackle stack on non-default ports (see the doc for port setup)
2. Use Playwright MCP to drive the app into the relevant states and capture PNGs
3. Wrap each PNG in an SVG (base64 embed) — `gh gist create` rejects binary files
4. Upload SVGs to a secret gist and grab the raw URLs
5. Include the raw URLs as markdown images in the PR body (Step 7)

After capture, clean up: stop your server processes, remove temporary `GRACKLE_HOME`.

## Step 7: Create the PR

Derive the PR title from the issue title (if available) or the branch name. Keep it under 70 characters.

```bash
gh pr create --title "<PR_TITLE>" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points describing the changes>

## Test plan
- [ ] <testing checklist items>

## Screenshots
<if captured in Step 6, embed markdown images here; omit this section if no screenshots>

<if ISSUE_NUMBER is set: Closes #ISSUE_NUMBER>
EOF
)"
```

- Include `Closes #<ISSUE_NUMBER>` (or `Fixes #<ISSUE_NUMBER>`) only if an issue was detected in Step 0. Omit the line entirely when there is no linked issue.
- Include the Screenshots section only if Step 6 produced them
- Use a heredoc for body formatting to preserve markdown structure

## Step 8: Report

Summarize:
- PR URL
- Change file generated (yes/no, bump type)
- Screenshots included (yes/no)
- Issue linked (yes/no, issue number)
- Suggest running `/pr-fixup` to handle Copilot review + CI
