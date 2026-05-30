# @grackle-ai/coverage-merge

Unions per-suite lcov coverage into a single repo-wide total.

Grackle collects coverage from three suites that each write their own
`coverage/lcov.info`:

- **Vitest unit** — one per package (`packages/*/coverage/lcov.info`, `scripts/*/coverage/lcov.info`).
- **Storybook interaction** — `packages/web-components/coverage/lcov.info` (added in a follow-up ticket).
- **Playwright E2E** — `tests/e2e-tests/coverage/lcov.info` (one per shard).

Because the same source file (e.g. `packages/web/src/App.tsx`) is exercised by
more than one suite, a simple concatenation double-counts. This tool **unions**
the records: per-line/-function/-branch hit counts are summed across suites and
an item counts as covered when any suite executed it. Source paths are
normalized to repo-root-relative POSIX so the same file from different suites
collapses to one key.

## Usage

```bash
node scripts/coverage-merge/dist/index.js [roots...] \
  --out coverage/combined/lcov.info \
  --summary "$GITHUB_STEP_SUMMARY" \
  --require-source packages/web/src
```

- `roots...` — directories to scan recursively for `lcov.info` (default: cwd). `node_modules`, `dist`, `.git`, `.rush` are skipped.
- `--out <file>` — combined lcov output path (default `coverage/combined/lcov.info`).
- `--summary <md-file>` — append a Markdown summary table (used to write `$GITHUB_STEP_SUMMARY` in CI).
- `--require-source <substring>` — exit non-zero if no merged source path contains the substring (CI guard that expected coverage actually landed).

The combined total (lines / functions / branches) is printed to stdout.
