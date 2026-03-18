---
name: rush-change
description: Generate a Rush change file for the current branch, handling merge-commit false positives automatically. Run with /rush-change.
---

# Rush Change — Smart Change File Generator

This skill generates a Rush change file for the current branch. It detects merge-commit false positives (where `rush change --verify` flags packages that have no real diff against main) and handles them automatically.

## Step 1: Pre-flight Checks

```bash
git fetch origin
```

Check if the branch already has a change file:

```bash
git diff --name-only origin/main...HEAD -- common/changes/
```

If change files already exist in the branch diff, report them and stop — no new change file needed.

## Step 2: Check if Rush Requires a Change File

```bash
node common/scripts/install-run-rush.js change --verify 2>&1
```

If this passes (exit 0), no change file is needed. Report success and stop.

## Step 3: Determine Real vs False-Positive Changes

Rush says a change file is needed. Now determine whether publishable packages actually changed, or if this is a merge-commit false positive.

Get the **net diff** against main (two-dot diff — ignores merge commit artifacts):

```bash
git diff --name-only origin/main
```

Check if any of the changed files fall within a **publishable package** directory:

- `packages/cli/`
- `packages/common/`
- `packages/powerline/`
- `packages/server/`
- `packages/adapter-sdk/`
- `packages/mcp/`

### Case A: Real changes in publishable packages

If the diff touches publishable package directories, this is a **real** change that needs a proper change file.

1. Examine the diff to determine the appropriate bump type:
   - `patch` — bug fixes, internal refactoring, dependency updates
   - `minor` — new features, new APIs, backwards-compatible additions
   - **Never use `major`** — CI blocks major bumps (pre-1.0)
   - `none` — changes that don't affect the published package (e.g., only test files, dev tooling within the package)

2. Write a concise comment describing the change (what it does, not what files changed).

3. Generate the change file:
   ```bash
   node common/scripts/install-run-rush.js change --bulk \
     --message "placeholder" \
     --bump-type patch \
     --email "5674316+nick-pape@users.noreply.github.com"
   ```

4. Find the generated JSON file in `common/changes/@grackle-ai/*/` and edit it:
   - Set `"comment"` to the real description
   - Set `"type"` to the correct bump type determined above

### Case B: False positive (merge-commit artifact)

If the diff does NOT touch any publishable package directories, Rush is flagging packages due to merge commits bringing in files from main. Generate a `none` change file:

```bash
node common/scripts/install-run-rush.js change --bulk \
  --message "placeholder" \
  --bump-type none \
  --email "5674316+nick-pape@users.noreply.github.com"
```

No need to edit the comment — `"placeholder"` is fine for `none` type changes.

## Step 4: Verify and Commit

Run verify again to confirm the change file satisfies Rush:

```bash
node common/scripts/install-run-rush.js change --verify
```

If it passes, commit:

```bash
git add common/changes/
git commit -m "Add rush change file"
```

If it still fails, read the error output and generate additional change files as needed (Rush may flag multiple packages in rare cases).

## Step 5: Report

Summarize:
- Whether this was a real change or a merge-commit false positive
- The bump type and comment used
- The path of the generated change file
