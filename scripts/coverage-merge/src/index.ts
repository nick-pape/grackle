#!/usr/bin/env node
// CLI entry: scan one or more roots for `lcov.info` files (unit, Storybook,
// E2E), union them into a single repo-wide lcov + total, emit a per-package
// breakdown, and (optionally) gate per-package combined coverage against floors.
//
// Usage:
//   coverage-merge [roots...] [--out <file>] [--summary <md-file>]
//                  [--require-source <substring>] [--combined-thresholds <json>]
//
// `--require-source` exits non-zero if no merged source path contains the
// substring (guard that expected coverage landed). `--combined-thresholds`
// points at a JSON map `{ "packages/<pkg>": {lines,functions,branches} }`; any
// package below its floor on any metric fails the run. The merge/analysis logic
// lives in `run.ts`.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";

import { writeLcov } from "./merge.js";
import {
  LCOV_FILENAME,
  findLcovFiles,
  analyzeCoverage,
  hasSourceMatching,
  renderTextTable,
  renderMarkdown,
  renderPerPackageMarkdown,
  summarizeByPackage,
  checkCombinedThresholds,
  type Analysis,
  type MergeResult,
  type CombinedFloor,
} from "./run.js";

/** Parsed command-line options. */
interface CliOptions {
  roots: string[];
  out: string;
  summary: string | undefined;
  requireSource: string | undefined;
  combinedThresholds: string | undefined;
}

/** Parse argv (excluding node + script) into {@link CliOptions}. */
function parseArgs(argv: string[]): CliOptions {
  const roots: string[] = [];
  let out: string = join("coverage", "combined", LCOV_FILENAME);
  let summary: string | undefined;
  let requireSource: string | undefined;
  let combinedThresholds: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg: string = argv[i];
    if (arg === "--out") {
      out = argv[++i];
    } else if (arg === "--summary") {
      summary = argv[++i];
    } else if (arg === "--require-source") {
      requireSource = argv[++i];
    } else if (arg === "--combined-thresholds") {
      combinedThresholds = argv[++i];
    } else {
      roots.push(arg);
    }
  }
  if (roots.length === 0) {
    roots.push(process.cwd());
  }
  return { roots, out, summary, requireSource, combinedThresholds };
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

  const analysis: Analysis = analyzeCoverage(lcovFiles);
  const result: MergeResult = {
    merged: analysis.combined,
    summary: analysis.summary,
    fileCount: analysis.fileCount,
  };

  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, writeLcov(analysis.combined), "utf8");

  process.stdout.write(`\n${renderTextTable(result, analysis.combined.size)}\n`);
  process.stdout.write(`\n[coverage-merge] Combined lcov written to ${options.out}\n`);

  if (options.summary) {
    appendFileSync(options.summary, renderMarkdown(result, analysis.combined.size), "utf8");
    appendFileSync(options.summary, renderPerPackageMarkdown(analysis), "utf8");
  }

  if (options.requireSource && !hasSourceMatching(analysis.combined, options.requireSource)) {
    process.stderr.write(
      `[coverage-merge] ERROR: no merged source path contains "${options.requireSource}". ` +
        `Expected coverage was not produced (e.g. E2E coverage did not land).\n`,
    );
    process.exit(1);
  }

  if (options.combinedThresholds) {
    const floors: Record<string, CombinedFloor> = JSON.parse(
      readFileSync(resolve(options.combinedThresholds), "utf8"),
    );
    const perPackage = summarizeByPackage(analysis.combined);
    const { violations, unenforced, missingCoverage, enforcedCount } = checkCombinedThresholds(
      perPackage,
      floors,
    );
    for (const pkg of unenforced) {
      process.stderr.write(
        `[coverage-merge] WARNING: ${pkg} has combined coverage but no threshold entry — unenforced.\n`,
      );
    }
    for (const pkg of missingCoverage) {
      process.stderr.write(
        `[coverage-merge] WARNING: ${pkg} has a threshold entry but no combined coverage — ` +
          `not enforced (missing artifact or removed package?).\n`,
      );
    }
    if (violations.length > 0) {
      const pkgCount: number = new Set(violations.map((v) => v.pkg)).size;
      process.stderr.write(
        `\n[coverage-merge] ERROR: ${violations.length} combined-coverage floor violation(s) ` +
          `across ${pkgCount} package(s):\n`,
      );
      for (const v of violations) {
        process.stderr.write(`  ✗ ${v.message}\n`);
      }
      process.exit(1);
    }
    process.stdout.write(
      `\n[coverage-merge] All ${enforcedCount} enforced package(s) meet their combined coverage floor.\n`,
    );
  }
}

main();
