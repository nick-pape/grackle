# Grackle Development Guidelines

## Self-Updating Documentation

When you encounter unexpected issues, workarounds, or non-obvious behavior (CI quirks, tooling gotchas, environment-specific problems), **update this CLAUDE.md** with the finding so future sessions don't repeat the investigation. Add the note to the most relevant existing section, or create a new one if needed.

### Package READMEs

Each package under `packages/` has a `README.md` that is published to npm. **When you change a package's public behavior** (new commands, renamed options, new MCP tools, new API methods, changed configuration, etc.), **update that package's README to match.** Do not let READMEs drift out of sync with the code.

- **CLI** (`packages/cli/README.md`): documents every command, subcommand, and flag. Update when adding/removing/renaming commands or options.
- **MCP** (`packages/mcp/README.md`): documents every MCP tool with parameters. Update when adding/removing/renaming tools.
- **Knowledge Core** (`packages/knowledge-core/README.md`): detailed API reference. Update when the public API changes.
- **All other packages**: concise overviews. Update if the package's purpose, key concepts, or usage instructions change.

Do **not** update the root `README.md` as part of this process — it is a separate marketing/overview document maintained independently.

## Git Workflow

- **Never push directly to main.** All changes must go through a pull request. Always create a feature branch and open a PR — never commit and push to `main`.
- **Never rebase or force-push.** To sync with `main`, first run `git fetch origin` and then use `git merge origin/main` instead of `git rebase`. Rebasing published branches rewrites history and typically requires a force-push, which we do not allow.
- **Never merge PRs** unless the user explicitly tells you to merge. Other agents may be coordinating merge order.
- **Branch naming**: `<github-username>/<issue>-<feature>` when working on a GitHub issue (where `<issue>` is the numeric issue id, e.g., `nick-pape/149-agent-subtask-creation`), or `<github-username>/<feature>` when there's no issue (e.g., `nick-pape/fix-typo-in-readme`).

### Worktree Workflow

**All feature work must happen in a worktree**, not on the main working copy. Use Claude Code's built-in `EnterWorktree` tool to create an isolated worktree — it handles cwd, branch creation, and cleanup automatically.

**Starting work:**
1. Call `EnterWorktree` with a descriptive name (e.g., `EnterWorktree({ name: "123-my-feature" })`)
2. This creates `.claude/worktrees/123-my-feature/` with branch `worktree-123-my-feature` and switches your cwd there
3. Rename the branch to match our naming convention: `git branch -m <github-username>/123-my-feature`
4. Run `rush install && rush build`
5. Do all your work — cwd stays in the worktree, hooks fire correctly

**Finishing work:**
- After the PR is merged: call `ExitWorktree({ action: "remove" })` to clean up
- To pause and come back later: call `ExitWorktree({ action: "keep" })`

**Rules:**
- Never check out a feature branch on the main worktree — always use `EnterWorktree`
- Rename the branch immediately after entering (`git branch -m <github-username>/<issue>-<feature>`) to match our branch naming convention
- Each worktree needs its own `rush install && rush build` (node_modules are per-worktree)
- You can't have the same branch checked out in two worktrees simultaneously
- When syncing with main inside a worktree: `git fetch origin && git merge origin/main` (same as always, no rebase)

## Planning

- **Always plan tests**: Every implementation plan must include a section for tests (E2E Playwright specs for `@grackle-ai/web`, unit/integration tests for other packages). If the change is purely cosmetic or untestable, explicitly note why tests are skipped.
- **Prefer `data-testid` in E2E tests**: Use `data-testid` attributes and `page.getByTestId()` to locate elements in Playwright tests rather than fragile DOM selectors like `getByText()` with `{ exact: true }`. Text-based locators break when the same text appears in multiple places (e.g., StatusBar and page content). Add `data-testid` to components when writing tests that need to disambiguate.
- **Scope workspace-name locators to the sidebar in E2E tests**: the dashboard home page reuses workspace names in cards, so unscoped `page.getByText(workspaceName)` calls can hit Playwright strict-mode violations. Prefer helpers or locators rooted under `data-testid="sidebar"` when clicking workspace rows or adjacent sidebar controls.
- **Tag every e2e `test.describe()` block**: Every `test.describe()` in `tests/e2e-tests/tests/` must include a Playwright native tag — CI enforces this via `lint-e2e-tags.sh`, which checks that every `test.describe()` call in each spec file has a `tag` option. Use the syntax `test.describe("Name", { tag: ["@domain"] }, () => {` with one or more tags from: `@task`, `@workspace`, `@environment`, `@session`, `@settings`, `@persona`, `@webui`, `@error`, `@smoke`. This enables selective e2e test running — CI only runs tests relevant to the changed packages.
- **Open a PR as the final step**: Use `/create-pr` to open the PR. The PR body must link back to the issue.

## Build & Test

- **Never disable or skip failing tests to make CI pass.** If tests fail, investigate the root cause and fix the actual bug. Do not use `test.skip`, `test.fixme`, or equivalent to silence failures — the tests exist for a reason. If tests fail on your branch but pass on main, your changes broke them.

**Run `rush install` frequently.** Always run it:
- Before starting work (ensures dependencies are linked)
- After switching branches or merging main (lockfile may have changed)
- After changing any `package.json` (then `rush update` if install tells you to)

`rush build` does NOT install dependencies — you must run `rush install` separately. If dependencies seem broken (empty `node_modules`, missing binaries like `tsc`), use `rush install --purge` to blow away all `node_modules` and reinstall from scratch.

```bash
# Install dependencies and build all packages
rush install && rush build
# Only run `rush update` if `rush install` fails and tells you to (e.g. after changing package.json)

# Build a single package
rush build -t @grackle-ai/<package>

# Run proto codegen (from packages/common)
npx buf generate
```

- **Treat "SUCCESS WITH WARNINGS" as a build failure.** CI runs `rush build` with warnings-as-errors. If your local `rush build` reports `Operations succeeded with warnings`, fix every warning before pushing — it **will** fail CI. Common culprits: missing type annotations (`@rushstack/typedef-var`), `null` instead of `undefined` (`@rushstack/no-new-null`), unused imports, and Vite chunk size warnings.
- **Do not introduce new bare `tsc`, `npx`, or package-local script usages for builds/tests/tooling.** All *new* build, test, and tooling commands MUST go through Rush (`rush build`, `rush install`, `rushx`) or Heft (`heft build`, `heft test`). Bare commands like `npx tsc`, `npx vitest`, or `node_modules/.bin/...` bypass Rush's orchestration, miss dependency resolution, and may use wrong tool versions. The only exceptions are explicitly documented ones in this repo (e.g., `npx buf generate` for proto codegen and Storybook commands documented below).
- **Rebuild before manual testing**: After making code changes to any package, you must run `rush build -t @grackle-ai/<package>` before starting or restarting the server. The server runs compiled JS from `dist/`, not TypeScript source files.
- **CLI uses `GRACKLE_URL`, not `GRACKLE_PORT`**: The CLI client reads `GRACKLE_URL` (e.g., `http://127.0.0.1:7500`) to find the gRPC server. Setting `GRACKLE_PORT` only affects the server's listen port, not the CLI's connection target.
- **Playwright runs in parallel**: Each worker spawns its own isolated Grackle stack (4 ports + GRACKLE_HOME). Worker count defaults to `min(4, cpuCount/2)` locally, 2 in CI. Override via `E2E_WORKERS` env var.

### Storybook Component Tests

Components in `packages/web/src/components/` have Storybook stories (`.stories.tsx` files) with interaction tests (`play` functions). These test UI behavior in a real browser without the server stack.

```bash
# Run Storybook locally
cd packages/web && npm run storybook

# Build + run interaction tests headlessly
cd packages/web && npm run build-storybook
npx concurrently -k -s first \
  "npx http-server storybook-static --port 6006 --silent" \
  "npx wait-on tcp:127.0.0.1:6006 && npx test-storybook --url http://127.0.0.1:6006"
```

Storybook is integrated into the Heft build pipeline via `@grackle-ai/heft-web-test-plugin`:
- **`rush build`** runs `storybook build` as a heft build task (produces `storybook-static/`)
- **`rush test`** runs both vitest and `test-storybook` via heft test phase
- No separate CI step needed — it's part of the standard build/test flow

**When to use Storybook vs E2E:**
- **Storybook:** Pure component rendering, form validation, keyboard interaction, CSS checks, toggle behavior — anything that doesn't need the server
- **E2E (Playwright):** Flows requiring real WebSocket/gRPC (session spawning, task lifecycle, event streaming, server-side validation)

**Writing stories:**
- Place `.stories.tsx` next to the component file
- Import `expect, fn, userEvent` from `"@storybook/test"`
- Import mock data from `../../test-utils/storybook-helpers.js`
- Use `play` functions with `canvas.getByTestId()` / `canvas.getByRole()` for assertions
- Components needing `useGrackle()` require the `withMockGrackle` decorator from `src/test-utils/storybook-helpers.js`
- Page-level stories needing route params use `withMockGrackleRoute(["/tasks/task-001"], "/tasks/:taskId")` + `parameters: { skipRouter: true }` to provide their own MemoryRouter with `initialEntries`

## Manual Testing

**After finishing code changes, always manually test if the change is testable.** Don't rely solely on unit tests — unit tests mock everything and only verify wiring, not real behavior.

**Use `/launch-grackle` to start an isolated test server.** This finds free ports, creates a branch-specific home directory (isolated DB), launches the server, and reports back the URLs. Never use the default ports or the user's `~/.grackle` database for testing.

- **Web UI changes**: Use the Playwright MCP (`mcp__playwright__*`) to launch a browser, navigate the web UI, and verify visually that the feature works as expected.
- **Server / adapter changes** (e.g. SSH, Codespace): Use `/launch-grackle`, add an environment (`grackle env add`), and exercise the relevant flow (provision, stop, reconnect, etc.) against a real target. Use `gh codespace list` to find an available codespace for Codespace adapter testing.
- **CLI changes**: Run the CLI commands manually and verify the output matches expectations.
- **Verify screenshots**: Whenever you take screenshots (for testing or for a PR), always read the PNG file back with the Read tool and visually inspect it to confirm it shows what you expect. Don't assume a screenshot is correct just because the tool reported success.
- If you cannot manually test (e.g. no codespace available, or the change is purely internal refactoring with no observable behavior), explicitly state why manual testing was skipped.

## Project Structure

Rush monorepo with packages under `packages/`:
- `@grackle-ai/adapter-sdk` — SDK for building environment adapters (interfaces, bootstrap, tunnel helpers)
- `@grackle-ai/common` — Proto definitions, generated code, shared types
- `@grackle-ai/powerline` — gRPC PowerLine server (ConnectRPC on HTTP/2)
- `@grackle-ai/runtime-sdk` — Runtime interfaces, base classes, shared utilities (worktree, installer, async-queue)
- `@grackle-ai/runtime-claude-code` — ClaudeCodeRuntime (Anthropic Claude Agent SDK)
- `@grackle-ai/runtime-copilot` — CopilotRuntime (GitHub Copilot SDK)
- `@grackle-ai/runtime-codex` — CodexRuntime (OpenAI Codex SDK)
- `@grackle-ai/runtime-genaiscript` — GenAIScriptRuntime (GenAIScript CLI)
- `@grackle-ai/runtime-acp` — AcpRuntime (Agent Client Protocol over stdio)
- `@grackle-ai/server` — Central gRPC server, SQLite, WebSocket bridge
- `@grackle-ai/cli` — Commander-based CLI client
- `@grackle-ai/web` — React + Vite web UI

## Code Style

### TypeScript
- **TSDoc**: All exported functions, interfaces, types, and classes must have TSDoc comments
- **No magic numbers**: Extract numeric constants (timeouts, retries, byte lengths) into named constants at module scope
- **DRY**: Don't duplicate constants, types, or logic across packages. If a value is defined in `@grackle-ai/common` (or another shared package), import it — never copy it with a "mirrors X" comment. Large blocks of near-identical code should be extracted into shared helpers.
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
- Web UI uses pairing-code → session-cookie auth. The API key is never injected into HTML. gRPC uses Bearer token auth. WebSocket accepts either session cookie or `?token=` query param.
- The server binds to `127.0.0.1` by default. Use `grackle serve --allow-network` to bind to `0.0.0.0` for LAN access (e.g., phone). Use `grackle pair` to generate new pairing codes.

### React Component Architecture

- **New components must be pure presentational.** Components in `components/` should accept data and callbacks as props. Only page-level components (`pages/*.tsx`) should call `useGrackle()`.
- **All components decoupled from `useGrackle()`** ([#805](https://github.com/nick-pape/grackle/issues/805)). Only page-level components (`pages/*.tsx`) should call `useGrackle()`. If you add a new component, follow this pattern: accept data and callbacks as props.

### Dependencies
- Cross-package deps use `"workspace:*"` (pnpm rewrites to real versions at publish time)
- `@bufbuild/protobuf` must be a direct dependency in any package using `create()`
- Pin specific versions for runtime SDKs (not `@latest`)

### Database
- **Never access SQLite directly** — always go through the CLI (`grackle` commands)
- If the CLI is missing a needed operation, add it to `@grackle-ai/cli` rather than using raw SQL

## Change Files (Rush Change)

PRs that modify publishable packages need a change file. The `/create-pr` skill handles generation.

- If `/create-pr` or CI indicates a lockstep change is required for `@grackle-ai/cli`, do not delete that generated change file just because the visible code changes are in `@grackle-ai/web`; `rush change --verify` can still require the lockstep main project change description for this repo's release policy.

**Publishable packages** (lockstep versioning):
- `@grackle-ai/adapter-sdk`, `@grackle-ai/adapter-local`, `@grackle-ai/adapter-ssh`, `@grackle-ai/adapter-codespace`, `@grackle-ai/adapter-docker`, `@grackle-ai/auth`, `@grackle-ai/cli`, `@grackle-ai/common`, `@grackle-ai/core`, `@grackle-ai/powerline`, `@grackle-ai/prompt`, `@grackle-ai/runtime-sdk`, `@grackle-ai/runtime-claude-code`, `@grackle-ai/runtime-copilot`, `@grackle-ai/runtime-codex`, `@grackle-ai/runtime-genaiscript`, `@grackle-ai/runtime-acp`, `@grackle-ai/server`, `@grackle-ai/web-server`

**Not publishable** (never need change files):
- `@grackle-ai/web`, `@grackle-ai/heft-rig`, `@grackle-ai/heft-buf-plugin`, `@grackle-ai/heft-playwright-plugin`, `@grackle-ai/heft-vite-plugin`

## PR Workflow

- Use `/create-pr` to open a pull request (syncs with main, generates change files, captures screenshots, creates PR with issue linking).
- Use `/pr-fixup` to address Copilot review comments and wait for CI.
- **CI silently stops triggering** when the PR branch has a merge conflict with `main`. If pushes stop triggering CI, merge main first.

## Ports

| Service | Port | Constant |
|---------|------|----------|
| PowerLine | 7433 | `DEFAULT_POWERLINE_PORT` |
| Server gRPC | 7434 | `DEFAULT_SERVER_PORT` |
| Web UI + WS | 3000 | `DEFAULT_WEB_PORT` |
| MCP | 7435 | `DEFAULT_MCP_PORT` |

### Multi-Session Safety
Multiple Claude Code sessions may be running concurrently against the same repo. **Never kill server processes (node, grackle) unless you are certain they belong to your session.** Another agent may be using them.

**Always use `/launch-grackle`** to start a test server. It guarantees free ports, an isolated database, and reports back the correct URLs. Never use the default ports (7434, 3000, 7435, 7433) or the user's `~/.grackle` database directly.

## Semantic Search (qdrant-search MCP)

A `rush-qdrant mcp` daemon provides **semantic search** over the codebase via the `qdrant-search` MCP server.

**USE SEMANTIC SEARCH FIRST** when exploring code by concept, behavior, or intent. It understands natural language queries like "how does authentication work" or "websocket reconnection logic." Use `/codebase-search` to invoke the full search workflow, or call the MCP tools directly:

- **`mcp__qdrant-search__semantic_search`** — Conceptual/exploratory search. Returns ranked results with file IDs, similarity scores, breadcrumbs, and code previews. **Always pass `catalog: "grackle"`**.
- **`mcp__qdrant-search__view_chunks`** — Retrieve full source content by file ID from search results. Supports selectors (`:3`, `:2-5`, `:3-end`).

**When to use Grep/Glob instead**: exact string matches (`class SessionStore`), regex patterns, or symbol names you already know. If you don't know the exact name, start with semantic search.

### Catalog naming

The canonical catalog is `"grackle"` (the main repo folder name). Worktrees share the same codebase, so always use `catalog: "grackle"` regardless of which worktree you're in:

```
mcp__qdrant-search__semantic_search(query: "session spawning", catalog: "grackle")
```
