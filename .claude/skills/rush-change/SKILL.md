---
name: rush-change
description: Generate a Rush change file for the current branch, handling merge-commit false positives automatically. Run with /rush-change.
---

# Rush Change — Smart Change File Generator

This skill generates a Rush change file for the current branch. It detects merge-commit false positives (where `rush change --verify` flags packages that have no real diff against main) and handles them automatically.

## Step 1: Check if Rush Requires a Change File

```bash
git fetch origin
node common/scripts/install-run-rush.js change --verify 2>&1
```

If this passes (exit 0), no change file is needed. Report success and stop.

## Step 2: Determine Real vs False-Positive Changes

Rush says a change file is needed. Now determine whether publishable packages actually changed, or if this is a merge-commit false positive.

Get the **net committed diff** against main (explicit two-ref diff — compares branch tip to origin/main, ignoring merge commit artifacts and uncommitted changes):

```bash
git diff --name-only origin/main HEAD
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

3. Get the commit email for the change file:
   ```bash
   git config user.email
   ```

4. Generate the change file:
   ```bash
   node common/scripts/install-run-rush.js change --bulk \
     --message "placeholder" \
     --bump-type patch \
     --email "$(git config user.email)"
   ```

5. Find the generated JSON file in `common/changes/@grackle-ai/*/` and edit it:
   - Set `"comment"` to the real description
   - Set `"type"` to the correct bump type determined above

### Case B: False positive (merge-commit artifact)

If the diff does NOT touch any publishable package directories, Rush is flagging packages due to merge commits bringing in files from main. Generate a `none` change file:

```bash
node common/scripts/install-run-rush.js change --bulk \
  --message "placeholder" \
  --bump-type none \
  --email "$(git config user.email)"
```

No need to edit the comment — `"placeholder"` is fine for `none` type changes.

## Step 3: Verify and Commit

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

## Step 4: Report

Summarize:
- Whether this was a real change or a merge-commit false positive
- The bump type and comment used
- The path of the generated change file
