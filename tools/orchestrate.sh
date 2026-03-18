#!/usr/bin/env bash
# Quickstart script for the Grackle orchestrator agent.
# Usage: ./orchestrate.sh [claude args...]
# Example: ./orchestrate.sh "burn down the items in the #282 UX epic, go one at a time"

set -euo pipefail

GRACKLE_PORT="${GRACKLE_PORT:-7434}"

# Load API key from ~/.grackle/api-key if not already set
if [[ -z "${GRACKLE_API_KEY:-}" ]]; then
  API_KEY_FILE="$HOME/.grackle/api-key"
  if [[ -f "$API_KEY_FILE" ]]; then
    GRACKLE_API_KEY="$(cat "$API_KEY_FILE")"
    export GRACKLE_API_KEY
  else
    echo "Warning: GRACKLE_API_KEY not set and $API_KEY_FILE not found."
    echo "The grackle MCP server will not authenticate. Set GRACKLE_API_KEY or create $API_KEY_FILE."
  fi
fi

# Check that the Grackle server is running
if ! (netstat -ano 2>/dev/null | grep -q ":${GRACKLE_PORT}.*LISTEN"); then
  echo "Error: Grackle server not detected on port ${GRACKLE_PORT}."
  echo "Start it with: grackle serve"
  exit 1
fi

exec claude --agent orchestrate "$@"
