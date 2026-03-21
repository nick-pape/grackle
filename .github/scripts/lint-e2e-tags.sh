#!/usr/bin/env bash
# lint-e2e-tags.sh — Ensure every e2e spec file has at least one Playwright tag.
#
# Checks that each *.spec.ts file contains a `{ tag: [` pattern inside a
# test.describe() call. Exits non-zero if any spec file is missing tags.

set -euo pipefail

TESTS_DIR="${1:-tests/e2e-tests/tests}"
MISSING=()

for spec in "$TESTS_DIR"/*.spec.ts; do
  [ -f "$spec" ] || continue
  if ! grep -q '{ tag: \[' "$spec"; then
    MISSING+=("$(basename "$spec")")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "::error::The following e2e spec files are missing Playwright tags:"
  for f in "${MISSING[@]}"; do
    echo "  - $f"
  done
  echo ""
  echo "Every test.describe() must include a tag argument, e.g.:"
  echo '  test.describe("My Feature", { tag: ["@domain"] }, () => {'
  echo ""
  echo "Valid tags: @task, @workspace, @environment, @session, @settings, @persona, @webui, @error, @smoke"
  exit 1
fi

TOTAL=$(ls -1 "$TESTS_DIR"/*.spec.ts 2>/dev/null | wc -l)
echo "All $TOTAL spec files have Playwright tags."
