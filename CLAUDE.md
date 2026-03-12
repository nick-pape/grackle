# Grackle Development Guidelines

## Self-Updating Documentation

When you encounter unexpected issues, workarounds, or non-obvious behavior (CI quirks, tooling gotchas, environment-specific problems), **update this CLAUDE.md** with the finding so future sessions don't repeat the investigation. Add the note to the most relevant existing section, or create a new one if needed.

## Git Workflow

- **Never rebase or force-push.** To sync with `main`, first run `git fetch origin` and then use `git merge origin/main` instead of `git rebase`. Rebasing published branches rewrites history and typically requires a force-push, which we do not allow.
- **Never merge PRs** unless the user explicitly tells you to merge. Other agents may be coordinating merge order.
- **Branch naming**: `<github-username>/<issue>-<feature>` when working on a GitHub issue (where `<issue>` is the numeric issue id, e.g., `nick-pape/149-agent-subtask-creation`), or `<github-username>/<feature>` when there's no issue (e.g., `nick-pape/fix-typo-in-readme`).

## Planning

- **Always plan tests**: Every implementation plan must include a section for tests (E2E Playwright specs for `@grackle-ai/web`, unit/integration tests for other packages). If the change is purely cosmetic or untestable, explicitly note why tests are skipped.

## Build & Test

```bash
# Install dependencies and build all packages
rush update && rush build

# Build a single package
rush build -t @grackle-ai/<package>

# Run proto codegen (from packages/common)
npx buf generate
```

## Project Structure

Rush monorepo with 5 packages under `packages/`:
- `@grackle-ai/common` — Proto definitions, generated code, shared types
- `@grackle-ai/powerline` — gRPC PowerLine server (ConnectRPC on HTTP/2)
- `@grackle-ai/server` — Central gRPC server, SQLite, WebSocket bridge
- `@grackle-ai/cli` — Commander-based CLI client
- `@grackle-ai/web` — React + Vite web UI

## Code Style

### TypeScript
- **TSDoc**: All exported functions, interfaces, types, and classes must have TSDoc comments
- **No magic numbers**: Extract numeric constants (timeouts, retries, byte lengths) into named constants at module scope
- **Full braces**: Always use braces on if/else/for blocks, even single-line
- **Explicit types**: Prefer explicit return types on exported functions
- **Full English names**: Use `EnvironmentId` not `EnvId`, `SpawnOptions` not `SpawnOpts`
- **No side effects on import**: Entry points (index.ts) wrap initialization in a `main()` function

### Proto
- Message names: full English (e.g., `EnvironmentId`, `AddEnvironmentRequest`)
- Enums: use proto enums with `UPPER_SNAKE_CASE` values prefixed by type name
- Services: `Grackle` and `GracklePowerLine` (no `*Service` suffix)
- Generated code: `import { grackle, powerline } from "@grackle-ai/common"`

### Logging
- Server/PowerLine: use `pino` structured logger (`import { logger } from "./logger.js"`)
- CLI: use `chalk` for colored output, `console.log` for user-facing messages
- Never use `console.log` in server or PowerLine packages

### Security
- Validate file paths to prevent path traversal (token-writer, file operations)
- Use `ConnectError` with proper gRPC status codes (e.g., `Code.Unauthenticated`)
- Constant-time comparison for API key verification
- Bind servers to `127.0.0.1` only

### Dependencies
- Cross-package deps use version `"0.0.1"` (Rush doesn't support `workspace:*`)
- `@bufbuild/protobuf` must be a direct dependency in any package using `create()`
- Pin specific versions for runtime SDKs (not `@latest`)

### Database
- **Never access SQLite directly** — always go through the CLI (`grackle` commands)
- If the CLI is missing a needed operation, add it to `@grackle-ai/cli` rather than using raw SQL

## Change Files (Rush Change)

PRs that modify publishable packages must include a change file. CI enforces this with `rush change --verify`.

**Publishable packages** (lockstep versioning — all share one version):
- `@grackle-ai/cli`, `@grackle-ai/common`, `@grackle-ai/powerline`, `@grackle-ai/server`

**Not publishable** (private — never need change files):
- `@grackle-ai/web`, `@grackle-ai/heft-rig`, `@grackle-ai/heft-buf-plugin`, `@grackle-ai/heft-playwright-plugin`, `@grackle-ai/heft-vite-plugin`

**When to create a change file**: If the PR has a diff in any publishable package. If only private packages or non-package files (workflows, docs, config) changed, no change file is needed.

**Command** (non-interactive, from repo root):

> **Known issue:** `install-run-rush.js` splits `--message` values on spaces.
> Use a single hyphenated word for the message, then edit the generated JSON
> file to fix the comment text and bump type.

```bash
# Step 1: Generate the change file (use a single-word placeholder message)
node common/scripts/install-run-rush.js change --bulk \
  --message "placeholder" \
  --bump-type patch \
  --email "5674316+nick-pape@users.noreply.github.com"

# Step 2: Edit the generated JSON in common/changes/@grackle-ai/*/
# Fix the "comment" field to the real description and "type" to the correct bump type
```

**Bump types**:
- `patch` — bug fixes, internal changes
- `minor` — new features, backwards-compatible additions
- `none` — no version bump (infra, tooling, docs touching a publishable package)
- **Never use `major`** — CI blocks major bumps (we're pre-1.0)

**What the command does**: Creates a JSON file in `common/changes/` named after the branch. The file is committed to the PR branch. One change file per PR is sufficient — it covers all publishable packages via lockstep versioning.

**Merge commit false positives**: When a branch has merge commits from `origin/main`, Rush's change detection sees files from those merges as "changed" — even if the final `git diff` against main is clean. This commonly flags `@grackle-ai/cli` or other publishable packages as needing change files when only private packages were actually modified. **Fix**: add a `none` bump change file for the falsely flagged package. The change file must be **committed** (not just staged) for `rush change --verify` to detect it.

## PR Workflow: CI & Copilot Review

Every push to a PR branch triggers both **CI** and a **GitHub Copilot code review**. Both must pass before a PR is ready.

### CI
- CI runs `rush build` and `rush test` (Playwright e2e tests).
- If CI fails, read the failed log with `gh run view <id> --log-failed`, fix the issue, and push again.
- Common CI failures: chunk size warnings (add to `manualChunks` in `vite.config.ts`), Playwright strict mode violations (duplicate text from sidebar + new components).

### Copilot Review
- **Every push triggers a new Copilot review** — previous review comments may become outdated but new ones appear.
- **Automated**: Use `/pr-fixup` to run the full loop automatically — syncs with main, addresses all Copilot comments, and waits for CI. See `.claude/skills/pr-fixup/SKILL.md`.
- When asked to "deal with Copilot" or "address Copilot comments" manually:
  1. **Read** all comments: `gh api repos/nick-pape/grackle/pulls/<PR>/comments`
  2. **Fix** the code issues Copilot identified
  3. **Reply** to each comment explaining what was done: `gh api repos/nick-pape/grackle/pulls/<PR>/comments/<id>/replies -f body="..."`
  4. **Resolve** each conversation thread
  5. **Push** the fixes — this triggers another Copilot review
  6. **Wait** for the new review and repeat until all comments are resolved

### PR Screenshots
- When opening a PR that includes **visual/UI changes**, take a Playwright screenshot of the affected area and include it in the PR description.
- Use `mcp__playwright__browser_take_screenshot` (or Playwright's `page.screenshot()` in test code) to capture the screenshot.
- Embed screenshots in the PR body as markdown images: `![description](url)`. Upload via `gh` or attach inline.
- This helps reviewers quickly see what changed without running the app locally.

### PR Completion Checklist
Before considering a PR "done", always verify:
- [ ] CI is green (build + tests pass)
- [ ] All Copilot review comments are addressed and resolved
- [ ] No new Copilot comments from the latest push
- [ ] PR description includes screenshots for any visual/UI changes

## Ports

| Service | Port | Constant |
|---------|------|----------|
| PowerLine | 7433 | `DEFAULT_POWERLINE_PORT` |
| Server gRPC | 7434 | `DEFAULT_SERVER_PORT` |
| Web UI + WS | 3000 | `DEFAULT_WEB_PORT` |
