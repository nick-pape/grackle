#!/usr/bin/env bash
set -euo pipefail

# Ensure the Grackle data directory exists and is owned by the node user.
GRACKLE_DATA="${GRACKLE_HOME:=/grackle-home}/.grackle"
mkdir -p "$GRACKLE_DATA"
chown -R node:node "$GRACKLE_DATA"

# If the Docker socket is mounted, grant the node user access to it.
# On Linux hosts the socket GID may differ from any in-container group;
# on Docker Desktop (macOS / Windows) permissions are typically open.
DOCKER_SOCK="/var/run/docker.sock"
if [ -S "$DOCKER_SOCK" ]; then
  SOCK_GID="$(stat -c '%g' "$DOCKER_SOCK")"
  # Reuse an existing group with that GID, or create one.
  if ! getent group "$SOCK_GID" > /dev/null 2>&1; then
    groupadd -g "$SOCK_GID" dockerhost
  fi
  GROUP_NAME="$(getent group "$SOCK_GID" | cut -d: -f1)"
  usermod -aG "$GROUP_NAME" node
fi

# Drop from root to the node user and exec the CMD.
exec gosu node "$@"
