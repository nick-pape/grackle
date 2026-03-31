# Launch Grackle for Testing

Launches an isolated Grackle server instance with ephemeral ports and a branch-specific home directory. Prevents agents from conflicting with each other or destabilizing the user's real database.

## Invocation

```
/launch-grackle
```

## Prerequisites

- `rush build` must have been run (server runs from `dist/`)
- If you only changed one package, `rush build -t @grackle-ai/<package>` is sufficient

## Launch

Run the launch script from the repo root as a **single** Bash call:

```bash
bash .claude/scripts/launch-grackle.sh
```

The script finds 4 free ports, creates a branch-specific home directory, starts the server, waits for it to be ready, reads the API key, generates a pairing code, and prints all connection details. It also writes `$GRACKLE_HOME/env.sh` for use in follow-up calls.

## Using the env in follow-up bash calls

Each subsequent bash call can source the env file to restore all variables:

```bash
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SAFE_BRANCH="$(printf '%s' "$BRANCH" | tr '/' '-' | tr -c 'a-zA-Z0-9_-' '_')"
source "/tmp/grackle-${SAFE_BRANCH}/env.sh"
# Now $GRPC_PORT, $WEB_PORT, $GRACKLE_API_KEY, $SERVER_PID, etc. are available
```

## Pairing / Auth Flow

The web UI uses pairing-code authentication — it does NOT accept the API key directly. You must complete pairing before the browser can access the UI.

**How pairing works:**
1. The server generates a 6-character pairing code
2. A browser hits `/pair?code=XXXXXX` — this redeems the code and sets a session cookie
3. All subsequent web requests use the session cookie (valid for 24 hours)
4. Without a valid session cookie, the browser is redirected to `/pair`
5. Pairing codes expire after 5 minutes. Run `grackle pair` to generate a new one.

**For Playwright MCP testing:**
- You MUST navigate to the **pairing URL** first before testing the web UI
- Navigate to `$PAIRING_URL` — this will set the session cookie and redirect to `/`
- After that, the browser has a valid session and you can navigate freely
- If the pairing code has expired, source the env file (above) then generate a new one:
  ```bash
  GRACKLE_URL="http://127.0.0.1:$GRPC_PORT" GRACKLE_API_KEY="$GRACKLE_API_KEY" grackle pair
  ```

**For CLI / gRPC usage:**
- CLI uses the API key (Bearer token), not pairing codes
- Set `GRACKLE_URL` and `GRACKLE_API_KEY` as env vars

## Cleanup

```bash
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SAFE_BRANCH="$(printf '%s' "$BRANCH" | tr '/' '-' | tr -c 'a-zA-Z0-9_-' '_')"
source "/tmp/grackle-${SAFE_BRANCH}/env.sh"
kill $SERVER_PID 2>/dev/null
```

To fully reset the database, delete the home directory:

```bash
rm -rf "$GRACKLE_HOME"
```

## Important Notes

- **Never kill processes you didn't start.** Only kill the PID from your own launch.
- **Never use the user's default ports** (7434, 3000, 7435, 7433). Always use this skill to get isolated ports.
- **Always use `GRACKLE_URL` (not `GRACKLE_PORT`)** when running CLI commands against your test server.
- **Always pair before browsing.** Navigate to the pairing URL before any Playwright testing.
- The database at `$GRACKLE_HOME/.grackle/grackle.db` is fully isolated from `~/.grackle/grackle.db`.
