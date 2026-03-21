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

  # Count all test.describe() calls in the spec
  total_describes=$(grep -c 'test\.describe\s*(' "$spec" || true)

  # Count test.describe() calls whose options object includes a tag property
  tagged_describes=$(grep -c -E 'test\.describe\s*\([^,]+,\s*\{\s*tag\s*:\s*\[' "$spec" || true)

  # A spec is missing tags if it has no describes, or if any describe lacks tags
  if [ "$total_describes" -eq 0 ] || [ "$tagged_describes" -lt "$total_describes" ]; then
    MISSING+=("$(basename "$spec") ($tagged_describes/$total_describes tagged)")
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
