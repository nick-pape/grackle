# Grackle Development Guidelines

## Build & Test

```bash
# Install dependencies and build all packages
rush update && rush build

# Build a single package
rush build -t @grackle/<package>

# Run proto codegen (from packages/common)
npx buf generate
```

## Project Structure

Rush monorepo with 5 packages under `packages/`:
- `@grackle/common` — Proto definitions, generated code, shared types
- `@grackle/powerline` — gRPC PowerLine server (ConnectRPC on HTTP/2)
- `@grackle/server` — Central gRPC server, SQLite, WebSocket bridge
- `@grackle/cli` — Commander-based CLI client
- `@grackle/web` — React + Vite web UI

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
- Generated code: `import { grackle, powerline } from "@grackle/common"`

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
- If the CLI is missing a needed operation, add it to `@grackle/cli` rather than using raw SQL

## Ports

| Service | Port | Constant |
|---------|------|----------|
| PowerLine | 7433 | `DEFAULT_POWERLINE_PORT` |
| Server gRPC | 7434 | `DEFAULT_SERVER_PORT` |
| Web UI + WS | 3000 | `DEFAULT_WEB_PORT` |
