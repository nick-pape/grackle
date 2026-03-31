# Launch Grackle for Testing

Launches an isolated Grackle server instance with ephemeral ports and a branch-specific home directory. Prevents agents from conflicting with each other or destabilizing the user's real database.

## Invocation

```
/launch-grackle
```

## Prerequisites

- `rush build` must have been run (server runs from `dist/`)
- If you only changed one package, `rush build -t @grackle-ai/<package>` is sufficient

## Launch (run as a single bash call)

> **Important:** Run the entire block below as **one** Bash call. Variables set in one call do not persist to the next in MSYS2/Git Bash, so splitting across multiple calls will cause `$GRACKLE_HOME`, `$GRPC_PORT`, and friends to be empty in later steps — producing broken paths like `/.grackle/api-key` or `C:\Program Files\Git\packages\...`.

```bash
# === Find 4 free ports ===
GRACKLE_PORTS="$(node -e "
const net = require('net');
function findPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}
async function main() {
  const ports = new Set();
  while (ports.size < 4) { ports.add(await findPort()); }
  console.log([...ports].join(' '));
}
main();
")"
if [ $? -ne 0 ] || [ -z "$GRACKLE_PORTS" ]; then
  echo "Error: failed to allocate ports via node; GRACKLE_PORTS='$GRACKLE_PORTS'" >&2
  exit 1
fi
read -r GRPC_PORT WEB_PORT MCP_PORT POWERLINE_PORT <<< "$GRACKLE_PORTS"
for p in "$GRPC_PORT" "$WEB_PORT" "$MCP_PORT" "$POWERLINE_PORT"; do
  case "$p" in
    ''|*[!0-9]*) echo "Error: invalid port value '$p' in GRACKLE_PORTS='$GRACKLE_PORTS'" >&2; exit 1 ;;
  esac
done
echo "Ports: gRPC=$GRPC_PORT web=$WEB_PORT mcp=$MCP_PORT powerline=$POWERLINE_PORT"

# === Create isolated home directory ===
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SAFE_BRANCH="$(printf '%s' "$BRANCH" | tr '/' '-' | tr -c 'a-zA-Z0-9_-' '_')"
GRACKLE_HOME="/tmp/grackle-${SAFE_BRANCH}"
mkdir -p "$GRACKLE_HOME"
echo "GRACKLE_HOME=$GRACKLE_HOME"

# === Launch the server ===
REPO_ROOT="$(git rev-parse --show-toplevel)"
GRACKLE_PORT=$GRPC_PORT \
GRACKLE_WEB_PORT=$WEB_PORT \
GRACKLE_MCP_PORT=$MCP_PORT \
GRACKLE_POWERLINE_PORT=$POWERLINE_PORT \
GRACKLE_HOST=127.0.0.1 \
GRACKLE_HOME="$GRACKLE_HOME" \
node "$REPO_ROOT/packages/server/dist/index.js" > "$GRACKLE_HOME/server.log" 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# === Wait for server to be ready ===
# Ports are passed via env vars to avoid MSYS2 converting numeric-looking shell
# variable substitutions inside the node -e string.
WAIT_GRPC=$GRPC_PORT WAIT_WEB=$WEB_PORT WAIT_PL=$POWERLINE_PORT node -e "
const net = require('net');
function parsePort(envName) {
  const raw = process.env[envName];
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    console.error('Environment variable ' + envName + ' must be a positive integer port, got: ' +
      (raw === undefined ? 'undefined' : JSON.stringify(raw)));
    process.exit(1);
  }
  return port;
}
const grpcPort = parsePort('WAIT_GRPC');
const webPort = parsePort('WAIT_WEB');
const powerlinePort = parsePort('WAIT_PL');
async function waitForPort(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const sock = net.createConnection({ host: '127.0.0.1', port });
        sock.once('connect', () => { sock.destroy(); resolve(); });
        sock.once('error', () => { sock.destroy(); reject(); });
      });
      return;
    } catch { await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error('Timeout waiting for port ' + port);
}
Promise.all([waitForPort(grpcPort), waitForPort(webPort), waitForPort(powerlinePort)])
  .then(() => console.log('Server ready'))
  .catch(e => { console.error(e.message); process.exit(1); });
"

# === Read the API key ===
API_KEY_FILE="$GRACKLE_HOME/.grackle/api-key"
TRIES=15
while [ ! -f "$API_KEY_FILE" ] && [ $TRIES -gt 0 ]; do
  sleep 1
  TRIES=$((TRIES - 1))
done
GRACKLE_API_KEY="$(cat "$API_KEY_FILE")"
echo "API key loaded (${#GRACKLE_API_KEY} chars)"

# === Generate a pairing code ===
PAIR_OUTPUT="$(GRACKLE_URL="http://127.0.0.1:$GRPC_PORT" GRACKLE_API_KEY="$GRACKLE_API_KEY" NO_COLOR=1 FORCE_COLOR=0 node "$REPO_ROOT/packages/cli/dist/index.js" pair 2>&1)"
PAIRING_CODE="$(echo "$PAIR_OUTPUT" | node -e "const m=require('fs').readFileSync(0,'utf8').match(/Pairing code:\s*(\S+)/);if(m)process.stdout.write(m[1])")"
if [ -z "$PAIRING_CODE" ]; then
  echo "Error: failed to extract pairing code from CLI output." >&2
  echo "Raw 'pair' command output:" >&2
  echo "$PAIR_OUTPUT" | head -n 40 >&2
  exit 1
fi
PAIRING_URL="http://127.0.0.1:$WEB_PORT/pair?code=$PAIRING_CODE"
echo "Pairing code: $PAIRING_CODE"
echo "Pairing URL:  $PAIRING_URL"

# === Save env to file so follow-up bash calls can source it ===
# Use printf '%q' to shell-escape all values (handles spaces, $, backslashes, etc.)
{
  printf 'export GRPC_PORT=%q\n' "$GRPC_PORT"
  printf 'export WEB_PORT=%q\n' "$WEB_PORT"
  printf 'export MCP_PORT=%q\n' "$MCP_PORT"
  printf 'export POWERLINE_PORT=%q\n' "$POWERLINE_PORT"
  printf 'export GRACKLE_HOME=%q\n' "$GRACKLE_HOME"
  printf 'export REPO_ROOT=%q\n' "$REPO_ROOT"
  printf 'export SERVER_PID=%q\n' "$SERVER_PID"
  printf 'export GRACKLE_API_KEY=%q\n' "$GRACKLE_API_KEY"
  printf 'export PAIRING_CODE=%q\n' "$PAIRING_CODE"
  printf 'export PAIRING_URL=%q\n' "$PAIRING_URL"
} > "$GRACKLE_HOME/env.sh"
chmod 600 "$GRACKLE_HOME/env.sh"

# === Report ===
echo ""
echo "=== Grackle Test Server Ready ==="
echo "  Web UI:       http://127.0.0.1:$WEB_PORT"
echo "  Pairing URL:  $PAIRING_URL"
echo "  gRPC:         http://127.0.0.1:$GRPC_PORT"
echo "  MCP:          http://127.0.0.1:$MCP_PORT/mcp"
echo "  PowerLine:    http://127.0.0.1:$POWERLINE_PORT"
echo "  API Key:      $GRACKLE_API_KEY"
echo "  Home:         $GRACKLE_HOME"
echo "  PID:          $SERVER_PID"
echo "  Server log:   $GRACKLE_HOME/server.log"
echo "  Env file:     $GRACKLE_HOME/env.sh"
echo ""
echo "CLI usage:"
echo "  GRACKLE_URL=http://127.0.0.1:$GRPC_PORT GRACKLE_API_KEY=$GRACKLE_API_KEY grackle <command>"
echo ""
echo "To stop:"
echo "  kill $SERVER_PID"
```

## Using the env in follow-up bash calls

After launch, any subsequent bash call can source the env file to restore all variables. Derive `GRACKLE_HOME` from the current branch (same formula as above):

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
- Navigate to `$PAIRING_URL` (e.g., `http://127.0.0.1:<port>/pair?code=XXXXXX`) — this will set the session cookie and redirect to `/`
- After that, the browser has a valid session and you can navigate freely
- If the pairing code has expired, generate a new one with:
  ```bash
  # Source the env file first (see above), then:
  GRACKLE_URL="http://127.0.0.1:$GRPC_PORT" GRACKLE_API_KEY="$GRACKLE_API_KEY" grackle pair
  ```

**For CLI / gRPC usage:**
- CLI uses the API key (Bearer token), not pairing codes
- Set `GRACKLE_URL` and `GRACKLE_API_KEY` as env vars

## Cleanup

When done testing, kill the server process:

```bash
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SAFE_BRANCH="$(printf '%s' "$BRANCH" | tr '/' '-' | tr -c 'a-zA-Z0-9_-' '_')"
source "/tmp/grackle-${SAFE_BRANCH}/env.sh"
kill $SERVER_PID 2>/dev/null
```

The branch-specific home directory at `$GRACKLE_HOME` persists across sessions so the database state is preserved for the branch. To fully reset, delete the directory:

```bash
rm -rf "$GRACKLE_HOME"
```

## Important Notes

- **Never kill processes you didn't start.** Only kill the PID from your own launch.
- **Never use the user's default ports** (7434, 3000, 7435, 7433). Always use this skill to get isolated ports.
- **Always use `GRACKLE_URL` (not `GRACKLE_PORT`)** when running CLI commands against your test server.
- **Always pair before browsing.** Navigate to the pairing URL before any Playwright testing.
- The database at `$GRACKLE_HOME/.grackle/grackle.db` is fully isolated from `~/.grackle/grackle.db`.
