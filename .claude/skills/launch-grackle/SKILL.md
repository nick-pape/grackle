# Launch Grackle for Testing

Launches an isolated Grackle server instance with guaranteed-free ports and a branch-specific home directory. Prevents agents from conflicting with each other or destabilizing the user's real database.

## Invocation

```
/launch-grackle
```

## Prerequisites

- `rush build` must have been run (server runs from `dist/`)
- If you only changed one package, `rush build -t @grackle-ai/<package>` is sufficient

## Step 1: Find Free Ports

Use this inline Node.js snippet to find 4 guaranteed-free, distinct ports:

```bash
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
read -r GRPC_PORT WEB_PORT MCP_PORT PL_PORT <<< "$GRACKLE_PORTS"
echo "Ports: gRPC=$GRPC_PORT web=$WEB_PORT mcp=$MCP_PORT powerline=$PL_PORT"
```

## Step 2: Create Isolated Home Directory

The home directory is based on the current git branch so each branch gets its own SQLite database:

```bash
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SAFE_BRANCH="$(printf '%s' "$BRANCH" | tr '/' '-' | tr -c 'a-zA-Z0-9_-' '_')"
export GRACKLE_HOME="/tmp/grackle-${SAFE_BRANCH}"
mkdir -p "$GRACKLE_HOME"
echo "GRACKLE_HOME=$GRACKLE_HOME"
```

## Step 3: Launch the Server

Start the server in the background with the allocated ports. The browser does not auto-open by default. Redirect output to a log file:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
GRACKLE_PORT=$GRPC_PORT \
GRACKLE_WEB_PORT=$WEB_PORT \
GRACKLE_MCP_PORT=$MCP_PORT \
GRACKLE_HOST=127.0.0.1 \
GRACKLE_HOME="$GRACKLE_HOME" \
node "$REPO_ROOT/packages/server/dist/index.js" > "$GRACKLE_HOME/server.log" 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"
```

## Step 4: Wait for Server to Be Ready

Wait for the gRPC and web ports to accept connections (up to 15 seconds):

```bash
node -e "
const net = require('net');
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
Promise.all([waitForPort($GRPC_PORT), waitForPort($WEB_PORT)])
  .then(() => console.log('Server ready'))
  .catch(e => { console.error(e.message); process.exit(1); });
"
```

## Step 5: Read the API Key

The server auto-generates an API key on first launch. Read it:

```bash
API_KEY_FILE="$GRACKLE_HOME/.grackle/api-key"
TRIES=15
while [ ! -f "$API_KEY_FILE" ] && [ $TRIES -gt 0 ]; do
  sleep 1
  TRIES=$((TRIES - 1))
done
GRACKLE_API_KEY="$(cat "$API_KEY_FILE")"
echo "API key loaded (${#GRACKLE_API_KEY} chars)"
```

## Step 6: Generate a Pairing Code

The web UI requires authentication via a pairing code. Generate one using the CLI:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
PAIR_OUTPUT="$(GRACKLE_URL="http://127.0.0.1:$GRPC_PORT" GRACKLE_API_KEY="$GRACKLE_API_KEY" NO_COLOR=1 FORCE_COLOR=0 node "$REPO_ROOT/packages/cli/dist/index.js" pair 2>&1)"
PAIRING_CODE="$(echo "$PAIR_OUTPUT" | grep -oP 'Pairing code:\s*\K\S+')"
PAIRING_URL="http://127.0.0.1:$WEB_PORT/pair?code=$PAIRING_CODE"
echo "Pairing code: $PAIRING_CODE"
echo "Pairing URL: $PAIRING_URL"
```

## Step 7: Report URLs

Print all the connection details:

```bash
echo ""
echo "=== Grackle Test Server Ready ==="
echo "  Web UI:       http://127.0.0.1:$WEB_PORT"
echo "  Pairing URL:  $PAIRING_URL"
echo "  gRPC:         http://127.0.0.1:$GRPC_PORT"
echo "  MCP:          http://127.0.0.1:$MCP_PORT/mcp"
echo "  API Key:      $GRACKLE_API_KEY"
echo "  Home:         $GRACKLE_HOME"
echo "  PID:          $SERVER_PID"
echo "  Server log:   $GRACKLE_HOME/server.log"
echo ""
echo "CLI usage:"
echo "  GRACKLE_URL=http://127.0.0.1:$GRPC_PORT GRACKLE_API_KEY=$GRACKLE_API_KEY grackle <command>"
echo ""
echo "To stop:"
echo "  kill $SERVER_PID"
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
  GRACKLE_URL="http://127.0.0.1:$GRPC_PORT" GRACKLE_API_KEY="$GRACKLE_API_KEY" grackle pair
  ```

**For CLI / gRPC usage:**
- CLI uses the API key (Bearer token), not pairing codes
- Set `GRACKLE_URL` and `GRACKLE_API_KEY` as env vars

## Cleanup

When done testing, kill the server process:

```bash
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
