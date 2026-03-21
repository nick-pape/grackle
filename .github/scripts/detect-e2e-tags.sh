#!/usr/bin/env bash
# detect-e2e-tags.sh — Determine which e2e test tags to run based on changed files.
#
# Usage: ./detect-e2e-tags.sh [base-ref]
# Output: Prints "all" (run everything) or a comma-separated tag list to stdout.
#
# Package-to-tag mapping:
#   common, web, cli, e2e-tests, infra → all
#   server     → @task,@workspace,@environment,@session,@settings,@persona,@error
#   powerline  → @environment,@session,@error
#   adapter-sdk → @environment
#   mcp        → @persona
#   knowledge  → @smoke
#   (no match) → @smoke

set -euo pipefail

BASE_REF="${1:-origin/main}"

# Get changed files relative to the base (three-dot for merge-base comparison)
CHANGED_FILES=$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null || git diff --name-only "$BASE_REF" HEAD 2>/dev/null || true)

if [ -z "$CHANGED_FILES" ]; then
  echo "all"
  exit 0
fi

# Track which packages changed
declare -A CHANGED_PACKAGES

while IFS= read -r file; do
  case "$file" in
    packages/common/*)      CHANGED_PACKAGES[common]=1 ;;
    packages/web/*)         CHANGED_PACKAGES[web]=1 ;;
    packages/server/*)      CHANGED_PACKAGES[server]=1 ;;
    packages/powerline/*)   CHANGED_PACKAGES[powerline]=1 ;;
    packages/adapter-sdk/*) CHANGED_PACKAGES[adapter-sdk]=1 ;;
    packages/mcp/*)         CHANGED_PACKAGES[mcp]=1 ;;
    packages/cli/*)         CHANGED_PACKAGES[cli]=1 ;;
    packages/knowledge/*)   CHANGED_PACKAGES[knowledge]=1 ;;
    tests/e2e-tests/*)      CHANGED_PACKAGES[e2e-tests]=1 ;;
    # CI config, rush config, root files, rigs → run everything
    .github/*|common/config/*|rush.json|pnpm-lock.yaml) CHANGED_PACKAGES[infra]=1 ;;
    rigs/*)                 CHANGED_PACKAGES[infra]=1 ;;
  esac
done <<< "$CHANGED_FILES"

# If any "run all" package changed, output "all"
for pkg in common web cli e2e-tests infra; do
  if [[ -v "CHANGED_PACKAGES[$pkg]" ]]; then
    echo "all"
    exit 0
  fi
done

# Map remaining packages to tags
declare -A TAGS

if [[ -v "CHANGED_PACKAGES[server]" ]]; then
  for tag in task workspace environment session settings persona error; do
    TAGS[$tag]=1
  done
fi

if [[ -v "CHANGED_PACKAGES[powerline]" ]]; then
  for tag in environment session error; do
    TAGS[$tag]=1
  done
fi

if [[ -v "CHANGED_PACKAGES[adapter-sdk]" ]]; then
  TAGS[environment]=1
fi

if [[ -v "CHANGED_PACKAGES[mcp]" ]]; then
  TAGS[persona]=1
fi

# Always include smoke tests in selective runs
TAGS[smoke]=1

# Build comma-separated output with @ prefix
RESULT=""
for tag in "${!TAGS[@]}"; do
  if [ -n "$RESULT" ]; then
    RESULT="$RESULT,@$tag"
  else
    RESULT="@$tag"
  fi
done

echo "$RESULT"
