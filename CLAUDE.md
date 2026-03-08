# Grackle Development Guidelines

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

Every PR must include a change file. CI enforces this with `rush change --verify`.

**Publishable packages** (lockstep versioning — all share one version):
- `@grackle-ai/cli`, `@grackle-ai/common`, `@grackle-ai/powerline`, `@grackle-ai/server`

**Not publishable** (private — never need change files):
- `@grackle-ai/web`, `@grackle-ai/heft-rig`, `@grackle-ai/heft-buf-plugin`, `@grackle-ai/heft-playwright-plugin`, `@grackle-ai/heft-vite-plugin`

**When to create a change file**: If the PR has a diff in any publishable package. If only private packages or non-package files (workflows, docs, config) changed, no change file is needed.

**Command** (non-interactive, from repo root):
```bash
node common/scripts/install-run-rush.js change --bulk \
  --message "Description of the change" \
  --bump-type patch \
  --email "5674316+nick-pape@users.noreply.github.com"
```

**Bump types**:
- `patch` — bug fixes, internal changes
- `minor` — new features, backwards-compatible additions
- `none` — no version bump (infra, tooling, docs touching a publishable package)
- **Never use `major`** — CI blocks major bumps (we're pre-1.0)

**What the command does**: Creates a JSON file in `common/changes/` named after the branch. The file is committed to the PR branch. One change file per PR is sufficient — it covers all publishable packages via lockstep versioning.

## Ports

| Service | Port | Constant |
|---------|------|----------|
| PowerLine | 7433 | `DEFAULT_POWERLINE_PORT` |
| Server gRPC | 7434 | `DEFAULT_SERVER_PORT` |
| Web UI + WS | 3000 | `DEFAULT_WEB_PORT` |
