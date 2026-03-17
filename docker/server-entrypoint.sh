#!/usr/bin/env bash
set -euo pipefail

# Ensure the Grackle data directory exists and is owned by the node user.
# Only chown the top-level dir (not -R) to avoid slow traversal on large volumes.
GRACKLE_DATA="${GRACKLE_HOME:=/grackle-home}/.grackle"
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

# Drop from root to the node user and exec the CMD.
# HOME is set to /home/node in the Dockerfile so gosu inherits it correctly.
exec gosu node "$@"
