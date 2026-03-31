#!/usr/bin/env bash
# Launch an isolated Grackle server instance for testing.
#
# Usage: bash .claude/scripts/launch-grackle.sh
#
# Outputs connection details and writes $GRACKLE_HOME/env.sh so follow-up
# bash calls can `source` it to restore GRPC_PORT, GRACKLE_API_KEY, etc.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

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
")" || { echo "Error: node port-finder exited non-zero" >&2; exit 1; }
if [ -z "$GRACKLE_PORTS" ]; then
  echo "Error: node port-finder produced no output" >&2
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
# Ports are passed via env vars to avoid MSYS2 converting numeric-looking
# shell variable substitutions inside the node -e string.
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
if [ ! -f "$API_KEY_FILE" ]; then
  echo "Error: API key file '$API_KEY_FILE' was not created within the expected time." >&2
  echo "Check '$GRACKLE_HOME/server.log' for details." >&2
  exit 1
fi
GRACKLE_API_KEY="$(cat "$API_KEY_FILE")"
echo "API key loaded (${#GRACKLE_API_KEY} chars)"

# === Generate a pairing code ===
PAIR_OUTPUT=""
if ! PAIR_OUTPUT="$(GRACKLE_URL="http://127.0.0.1:$GRPC_PORT" GRACKLE_API_KEY="$GRACKLE_API_KEY" NO_COLOR=1 FORCE_COLOR=0 node "$REPO_ROOT/packages/cli/dist/index.js" pair 2>&1)"; then
  echo "Error: 'grackle pair' CLI exited non-zero." >&2
  echo "Raw output:" >&2
  echo "$PAIR_OUTPUT" | head -n 40 >&2
  exit 1
fi
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
