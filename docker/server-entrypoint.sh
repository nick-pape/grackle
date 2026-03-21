#!/usr/bin/env bash
set -euo pipefail

# Ensure the Grackle data directory exists and is owned by the node user.
# Only chown the top-level dir (not -R) to avoid slow traversal on large volumes.
export GRACKLE_HOME="${GRACKLE_HOME:-/grackle-home}"
GRACKLE_DATA="${GRACKLE_HOME}/.grackle"
mkdir -p "$GRACKLE_DATA"
chown node:node "$GRACKLE_DATA"

# If the Docker socket is mounted, grant the node user access to it.
# On Linux hosts the socket GID may differ from any in-container group;
# on Docker Desktop (macOS / Windows) permissions are typically open.
DOCKER_SOCK="/var/run/docker.sock"
if [ -S "$DOCKER_SOCK" ]; then
  SOCK_GID="$(stat -c '%g' "$DOCKER_SOCK")"
  # Find an existing group with that GID, or create one.
  GROUP_NAME="$(awk -F: -v gid="$SOCK_GID" '$3 == gid { print $1; exit }' /etc/group)"
  if [ -z "$GROUP_NAME" ]; then
    groupadd -g "$SOCK_GID" dockerhost
    GROUP_NAME="dockerhost"
  fi
  usermod -aG "$GROUP_NAME" node
fi

# ── Writable Claude SDK config ───────────────────────────────────
# The host's ~/.claude is mounted read-only (for credentials + settings).
# The Claude Agent SDK needs to write session files to ~/.claude/projects/,
# so we create a writable copy in the persistent volume and point the SDK
# there via CLAUDE_CONFIG_DIR.
CLAUDE_RO="/home/node/.claude"
CLAUDE_RW="${GRACKLE_HOME}/.claude-sdk"
if [ -d "$CLAUDE_RO" ] && ! gosu node touch "$CLAUDE_RO/.write-test" 2>/dev/null; then
  mkdir -p "$CLAUDE_RW/projects"
  # Sync credential/config files from the RO mount (skip directories —
  # they'll be created fresh in the writable dir by the SDK as needed).
  for f in .credentials.json settings.json settings.local.json CLAUDE.md; do
    if [ -f "$CLAUDE_RO/$f" ]; then
      cp -pu "$CLAUDE_RO/$f" "$CLAUDE_RW/$f" 2>/dev/null || true
      if [ "$f" = ".credentials.json" ]; then
        chmod 600 "$CLAUDE_RW/$f" 2>/dev/null || true
      fi
    fi
  done
  chown -R node:node "$CLAUDE_RW"
  export CLAUDE_CONFIG_DIR="$CLAUDE_RW"
else
  # Mount is writable (or absent) — use it directly.
  rm -f "$CLAUDE_RO/.write-test" 2>/dev/null || true
fi

# Drop from root to the node user and exec the CMD.
# HOME is set to /home/node in the Dockerfile so gosu inherits it correctly.
exec gosu node "$@"
