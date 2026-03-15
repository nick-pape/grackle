# Grackle Development Guidelines

## Self-Updating Documentation

When you encounter unexpected issues, workarounds, or non-obvious behavior (CI quirks, tooling gotchas, environment-specific problems), **update this CLAUDE.md** with the finding so future sessions don't repeat the investigation. Add the note to the most relevant existing section, or create a new one if needed.

## Git Workflow

- **Never rebase or force-push.** To sync with `main`, first run `git fetch origin` and then use `git merge origin/main` instead of `git rebase`. Rebasing published branches rewrites history and typically requires a force-push, which we do not allow.
- **Never merge PRs** unless the user explicitly tells you to merge. Other agents may be coordinating merge order.
- **Branch naming**: `<github-username>/<issue>-<feature>` when working on a GitHub issue (where `<issue>` is the numeric issue id, e.g., `nick-pape/149-agent-subtask-creation`), or `<github-username>/<feature>` when there's no issue (e.g., `nick-pape/fix-typo-in-readme`).

## Planning

- **Always plan tests**: Every implementation plan must include a section for tests (E2E Playwright specs for `@grackle-ai/web`, unit/integration tests for other packages). If the change is purely cosmetic or untestable, explicitly note why tests are skipped.
- **Open a PR as the final step**: Use `/create-pr` to open the PR. The PR body must link back to the issue.

## Build & Test

```bash
# Install dependencies and build all packages
rush update && rush build

# Build a single package
rush build -t @grackle-ai/<package>

# Run proto codegen (from packages/common)
npx buf generate
```

- **Rebuild before manual testing**: After making code changes to any package, you must run `rush build -t @grackle-ai/<package>` before starting or restarting the server. The server runs compiled JS from `dist/`, not TypeScript source files.
- **CLI uses `GRACKLE_URL`, not `GRACKLE_PORT`**: The CLI client reads `GRACKLE_URL` (e.g., `http://127.0.0.1:7500`) to find the gRPC server. Setting `GRACKLE_PORT` only affects the server's listen port, not the CLI's connection target.

## Manual Testing

**After finishing code changes, always manually test if the change is testable.** Don't rely solely on unit tests — unit tests mock everything and only verify wiring, not real behavior.

- **Web UI changes**: Use the Playwright MCP (`mcp__playwright__*`) to launch a browser, navigate the web UI, and verify visually that the feature works as expected.
- **Server / adapter changes** (e.g. SSH, Codespace): Start the server (`grackle serve`), add an environment (`grackle env add`), and exercise the relevant flow (provision, stop, reconnect, etc.) against a real target. Use `gh codespace list` to find an available codespace for Codespace adapter testing.
- **CLI changes**: Run the CLI commands manually and verify the output matches expectations.
- If you cannot manually test (e.g. no codespace available, or the change is purely internal refactoring with no observable behavior), explicitly state why manual testing was skipped.

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
- Bind servers to loopback only (`127.0.0.1` or `::1`) — never `0.0.0.0` or `::`. The `--host` flag on `grackle serve` accepts both loopback addresses; the server validates this on startup.

### Dependencies
- Cross-package deps use `"workspace:*"` (pnpm rewrites to real versions at publish time)
- `@bufbuild/protobuf` must be a direct dependency in any package using `create()`
- Pin specific versions for runtime SDKs (not `@latest`)

### Database
- **Never access SQLite directly** — always go through the CLI (`grackle` commands)
- If the CLI is missing a needed operation, add it to `@grackle-ai/cli` rather than using raw SQL

## Change Files (Rush Change)

PRs that modify publishable packages need a change file. The `/create-pr` skill handles generation.

**Publishable packages** (lockstep versioning):
- `@grackle-ai/cli`, `@grackle-ai/common`, `@grackle-ai/powerline`, `@grackle-ai/server`

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
1. Check if the default ports are already in use (`netstat -ano | grep :<port> | grep LISTENING`).
2. If a server is already running on the default ports, **do not kill it and do not reuse it** — it belongs to another session with its own DB state.
3. Start your own server on different ports using environment variables: `GRACKLE_PORT=<grpc-port> GRACKLE_WEB_PORT=<web-port> node packages/server/dist/index.js`. Pick unused ports (e.g., 7500/7501, 7600/7601).
4. Point CLI commands at your server: `--port <your-grpc-port>` or set `GRACKLE_PORT`.
5. Note the PID so you can clean up your own process later without affecting other sessions.
