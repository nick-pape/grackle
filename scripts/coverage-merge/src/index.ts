#!/usr/bin/env node
// CLI entry: scan one or more roots for `lcov.info` files (unit, Storybook,
// E2E), union them into a single repo-wide lcov + total, and print the result.
//
// Usage:
//   coverage-merge [roots...] [--out <file>] [--summary <md-file>]
//                  [--require-source <substring>]
//
// Defaults: scans the current working directory; writes the combined lcov to
// `coverage/combined/lcov.info`. `--require-source` exits non-zero if no merged
// source path contains the substring (CI guard that expected coverage landed,
// e.g. `packages/web/src`). The merge/render logic lives in `run.ts`.

import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";

import { writeLcov } from "./merge.js";
import {
  LCOV_FILENAME,
  findLcovFiles,
  mergeLcovFiles,
  hasSourceMatching,
  renderTextTable,
  renderMarkdown,
  type MergeResult,
} from "./run.js";

/** Parsed command-line options. */
interface CliOptions {
  roots: string[];
  out: string;
  summary: string | undefined;
  requireSource: string | undefined;
}

/** Parse argv (excluding node + script) into {@link CliOptions}. */
function parseArgs(argv: string[]): CliOptions {
  const roots: string[] = [];
  let out: string = join("coverage", "combined", LCOV_FILENAME);
  let summary: string | undefined;
  let requireSource: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg: string = argv[i];
    if (arg === "--out") {
      out = argv[++i];
    } else if (arg === "--summary") {
      summary = argv[++i];
    } else if (arg === "--require-source") {
      requireSource = argv[++i];
    } else {
      roots.push(arg);
    }
  }
  if (roots.length === 0) {
    roots.push(process.cwd());
  }
  return { roots, out, summary, requireSource };
}

/** Program entry point. */
function main(): void {
  const options: CliOptions = parseArgs(process.argv.slice(2));
  const outAbs: string = resolve(options.out);

  const lcovFiles: string[] = [];
  for (const root of options.roots) {
    lcovFiles.push(...findLcovFiles(resolve(root), outAbs));
  }

  if (lcovFiles.length === 0) {
    process.stderr.write(
      `[coverage-merge] No ${LCOV_FILENAME} files found under: ${options.roots.join(", ")}\n`,
    );
    process.exit(1);
  }

  for (const file of lcovFiles) {
    process.stdout.write(
      `[coverage-merge] + ${relative(process.cwd(), file).split(sep).join("/")}\n`,
    );
  }

  const result: MergeResult = mergeLcovFiles(lcovFiles);

  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, writeLcov(result.merged), "utf8");

  process.stdout.write(`\n${renderTextTable(result, result.merged.size)}\n`);
  process.stdout.write(`\n[coverage-merge] Combined lcov written to ${options.out}\n`);

  if (options.summary) {
    appendFileSync(options.summary, renderMarkdown(result, result.merged.size), "utf8");
  }

  if (options.requireSource && !hasSourceMatching(result.merged, options.requireSource)) {
    process.stderr.write(
      `[coverage-merge] ERROR: no merged source path contains "${options.requireSource}". ` +
        `Expected coverage was not produced (e.g. E2E coverage did not land).\n`,
    );
    process.exit(1);
  }
}

main();
