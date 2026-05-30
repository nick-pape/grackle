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
  percentValue,
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

/** Which test suite an lcov file came from. */
export type Suite = "unit" | "e2e" | "storybook";

/** All suites in display order. */
export const SUITES: readonly Suite[] = ["unit", "e2e", "storybook"];

/**
 * Classify an lcov file by suite from its path tokens. Handles both the CI
 * artifact layout (coverage-input/{unit,e2e}/..., with coverage-storybook and
 * coverage-backend subdirs) and local paths (tests/e2e-tests/..., a package's
 * coverage-storybook dir).
 */
export function classifySuite(filePath: string): Suite {
  const p: string = filePath.replace(/\\/g, "/");
  if (p.includes("coverage-storybook")) {
    return "storybook";
  }
  if (p.includes("coverage-backend") || /(^|\/)e2e(\/|-)/.test(p)) {
    return "e2e";
  }
  return "unit";
}

/** Per-suite merged coverage maps. */
export interface SuiteMaps {
  unit: Map<string, FileCoverage>;
  e2e: Map<string, FileCoverage>;
  storybook: Map<string, FileCoverage>;
}

/** Full analysis: the combined union plus each suite's contribution. */
export interface Analysis {
  combined: Map<string, FileCoverage>;
  bySuite: SuiteMaps;
  summary: CoverageSummary;
  fileCount: number;
}

/** Parse + union a set of lcov files, keeping each suite's contribution separate. */
export function analyzeCoverage(files: readonly string[]): Analysis {
  const bySuite: SuiteMaps = { unit: new Map(), e2e: new Map(), storybook: new Map() };
  const all: Array<Map<string, FileCoverage>> = [];
  for (const file of files) {
    const map: Map<string, FileCoverage> = parseLcov(readFileSync(file, "utf8"), file);
    const suite: Suite = classifySuite(file);
    bySuite[suite] = mergeCoverageMaps([bySuite[suite], map]);
    all.push(map);
  }
  const combined: Map<string, FileCoverage> = mergeCoverageMaps(all);
  return { combined, bySuite, summary: summarize(combined), fileCount: files.length };
}

/** The package a repo-relative source path belongs to (e.g. `packages/web-components`), or undefined. */
export function packageKey(sourcePath: string): string | undefined {
  const parts: string[] = sourcePath.split("/");
  if ((parts[0] === "packages" || parts[0] === "scripts") && parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return undefined;
}

/** Summarize merged coverage grouped by package. */
export function summarizeByPackage(
  merged: Map<string, FileCoverage>,
): Map<string, CoverageSummary> {
  const byPkg: Map<string, Map<string, FileCoverage>> = new Map();
  for (const [path, cov] of merged) {
    const key: string | undefined = packageKey(path);
    if (key === undefined) {
      continue;
    }
    let group: Map<string, FileCoverage> | undefined = byPkg.get(key);
    if (group === undefined) {
      group = new Map();
      byPkg.set(key, group);
    }
    group.set(path, cov);
  }
  const out: Map<string, CoverageSummary> = new Map();
  for (const [key, group] of byPkg) {
    out.set(key, summarize(group));
  }
  return out;
}

/** Render the per-package table (per-suite + combined lines, plus combined fns/branches). */
export function renderPerPackageMarkdown(analysis: Analysis): string {
  const comb: Map<string, CoverageSummary> = summarizeByPackage(analysis.combined);
  const bySuite: Record<Suite, Map<string, CoverageSummary>> = {
    unit: summarizeByPackage(analysis.bySuite.unit),
    e2e: summarizeByPackage(analysis.bySuite.e2e),
    storybook: summarizeByPackage(analysis.bySuite.storybook),
  };
  const cell = (m: Map<string, CoverageSummary>, key: string): string => {
    const s: CoverageSummary | undefined = m.get(key);
    return s ? formatPercent(s.lines) : "–";
  };
  const lines: string[] = [
    "### Per-package combined coverage",
    "",
    "Lines per suite; **combined** is the union (covered by any suite).",
    "",
    "| Package | unit | e2e | storybook | **combined** | fns | branches |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const key of [...comb.keys()].sort()) {
    const c: CoverageSummary = comb.get(key)!;
    lines.push(
      `| ${key} | ${cell(bySuite.unit, key)} | ${cell(bySuite.e2e, key)} | ` +
        `${cell(bySuite.storybook, key)} | **${formatPercent(c.lines)}** | ` +
        `${formatPercent(c.functions)} | ${formatPercent(c.branches)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** A per-package combined floor (lines/functions/branches percentages). */
export interface CombinedFloor {
  lines: number;
  functions: number;
  branches: number;
}

/** A single per-metric threshold violation. */
export interface ThresholdViolation {
  /** The package that violated (e.g. `packages/web`). */
  pkg: string;
  /** Human-readable detail, e.g. `packages/web lines 35.0% < floor 40%`. */
  message: string;
}

/** Outcome of checking per-package combined coverage against floors. */
export interface ThresholdResult {
  /** Per-metric violations (a package can appear more than once). */
  violations: ThresholdViolation[];
  /** Packages with coverage but no floor entry (sorted) — unenforced. */
  unenforced: string[];
  /** Packages with a floor entry but no combined coverage (sorted) — not enforced. */
  missingCoverage: string[];
  /** Number of packages actually enforced (had both a floor and coverage). */
  enforcedCount: number;
}

/**
 * Check per-package combined coverage against floors. Returns per-metric
 * violations, plus diagnostics: packages whose floor could not be enforced
 * because they have no combined coverage (e.g. a missing artifact or a removed
 * package), and packages with coverage but no floor entry.
 */
export function checkCombinedThresholds(
  combined: Map<string, CoverageSummary>,
  floors: Record<string, CombinedFloor>,
): ThresholdResult {
  const violations: ThresholdViolation[] = [];
  const missingCoverage: string[] = [];
  let enforcedCount: number = 0;
  for (const [pkg, floor] of Object.entries(floors)) {
    const summary: CoverageSummary | undefined = combined.get(pkg);
    if (summary === undefined) {
      missingCoverage.push(pkg);
      continue;
    }
    enforcedCount += 1;
    const metrics: Array<[string, number, number]> = [
      ["lines", percentValue(summary.lines), floor.lines],
      ["functions", percentValue(summary.functions), floor.functions],
      ["branches", percentValue(summary.branches), floor.branches],
    ];
    for (const [name, actual, floorValue] of metrics) {
      if (actual + 1e-9 < floorValue) {
        violations.push({
          pkg,
          message: `${pkg} ${name} ${actual.toFixed(1)}% < floor ${floorValue}%`,
        });
      }
    }
  }
  const unenforced: string[] = [...combined.keys()].filter((k) => !(k in floors)).sort();
  missingCoverage.sort();
  return { violations, unenforced, missingCoverage, enforcedCount };
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
