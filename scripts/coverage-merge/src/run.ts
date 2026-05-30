// Filesystem + rendering helpers for the coverage-merge CLI, split out from
// `index.ts` so they are unit-testable without spawning a child process
// (index.ts itself is a thin argv/exit shell that calls these).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  parseLcov,
  mergeCoverageMaps,
  summarize,
  formatPercent,
  type FileCoverage,
  type CoverageSummary,
} from "./merge.js";

/** Directory names never descended into while scanning for lcov files. */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".rush",
  "dist",
  "lib",
  "temp",
]);

/** The lcov filename produced by every suite's coverage reporter. */
export const LCOV_FILENAME: string = "lcov.info";

/** Result of merging a set of lcov files. */
export interface MergeResult {
  /** Unioned per-file coverage keyed by repo-relative source path. */
  merged: Map<string, FileCoverage>;
  /** Repo-wide line/function/branch totals. */
  summary: CoverageSummary;
  /** Number of lcov files merged. */
  fileCount: number;
}

/**
 * Recursively collect absolute paths of every `lcov.info` under `root`,
 * skipping {@link SKIP_DIRS} and the merge output file itself.
 *
 * @param root - Directory to scan.
 * @param excludeAbs - Absolute path to skip (the combined output), or undefined.
 * @returns Absolute paths of discovered lcov files.
 */
export function findLcovFiles(root: string, excludeAbs?: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full: string = join(dir, entry);
      let isDir: boolean;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (!SKIP_DIRS.has(entry)) {
          walk(full);
        }
      } else if (entry === LCOV_FILENAME && resolve(full) !== excludeAbs) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

/** Parse and union a set of lcov files into one merged coverage map + summary. */
export function mergeLcovFiles(files: readonly string[]): MergeResult {
  const maps: Array<Map<string, FileCoverage>> = files.map((file) =>
    parseLcov(readFileSync(file, "utf8"), file),
  );
  const merged: Map<string, FileCoverage> = mergeCoverageMaps(maps);
  return { merged, summary: summarize(merged), fileCount: files.length };
}

/** True if any merged source path contains `substring` (CI "did coverage land" guard). */
export function hasSourceMatching(merged: Map<string, FileCoverage>, substring: string): boolean {
  for (const path of merged.keys()) {
    if (path.includes(substring)) {
      return true;
    }
  }
  return false;
}

/** Render the summary as an aligned plain-text block for stdout/logs. */
export function renderTextTable(result: MergeResult, sourceCount: number): string {
  const { summary, fileCount } = result;
  return [
    `Combined coverage across ${fileCount} lcov file(s), ${sourceCount} source file(s):`,
    `  Lines:     ${formatPercent(summary.lines)}  (${summary.lines.hit}/${summary.lines.found})`,
    `  Functions: ${formatPercent(summary.functions)}  (${summary.functions.hit}/${summary.functions.found})`,
    `  Branches:  ${formatPercent(summary.branches)}  (${summary.branches.hit}/${summary.branches.found})`,
  ].join("\n");
}

/** Render the summary as a GitHub-flavored Markdown table for the job summary. */
export function renderMarkdown(result: MergeResult, sourceCount: number): string {
  const { summary, fileCount } = result;
  return [
    "## Combined coverage (unit + Storybook + E2E)",
    "",
    `Merged ${fileCount} lcov file(s) covering ${sourceCount} source file(s).`,
    "",
    "| Metric | Coverage | Hit / Found |",
    "| --- | --- | --- |",
    `| Lines | ${formatPercent(summary.lines)} | ${summary.lines.hit} / ${summary.lines.found} |`,
    `| Functions | ${formatPercent(summary.functions)} | ${summary.functions.hit} / ${summary.functions.found} |`,
    `| Branches | ${formatPercent(summary.branches)} | ${summary.branches.hit} / ${summary.branches.found} |`,
    "",
  ].join("\n");
}
