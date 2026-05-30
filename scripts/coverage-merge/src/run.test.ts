import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  findLcovFiles,
  mergeLcovFiles,
  hasSourceMatching,
  renderTextTable,
  renderMarkdown,
} from "./run.js";

// Vitest writes PACKAGE-RELATIVE SF paths (resolved via the lcov's location,
// here <dir>/packages/web/coverage/lcov.info → packages/web/src/App.tsx).
const UNIT_LCOV: string = [
  "SF:src/App.tsx",
  "FN:10,render",
  "FNDA:1,render",
  "DA:10,1",
  "DA:11,0",
  "end_of_record",
  "",
].join("\n");

// monocart (E2E) writes REPO-RELATIVE SF paths. Same file, different line hit —
// normalization must collapse both conventions onto one key so they union.
const E2E_LCOV: string = [
  "SF:packages/web/src/App.tsx",
  "DA:10,0",
  "DA:11,3",
  "end_of_record",
  "",
].join("\n");

describe("run helpers (with real filesystem)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "covmerge-"));
    mkdirSync(join(dir, "packages", "web", "coverage"), { recursive: true });
    mkdirSync(join(dir, "tests", "e2e-tests", "coverage"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "pkg", "coverage"), { recursive: true });
    writeFileSync(join(dir, "packages", "web", "coverage", "lcov.info"), UNIT_LCOV);
    writeFileSync(join(dir, "tests", "e2e-tests", "coverage", "lcov.info"), E2E_LCOV);
    // Decoy under node_modules must be skipped.
    writeFileSync(join(dir, "node_modules", "pkg", "coverage", "lcov.info"), UNIT_LCOV);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds lcov files but skips node_modules and the output file", () => {
    const outAbs: string = join(dir, "packages", "web", "coverage", "lcov.info");
    const files: string[] = findLcovFiles(dir, outAbs);
    // node_modules decoy skipped; the excluded output file skipped; only e2e remains.
    expect(files).toHaveLength(1);
    expect(files[0]).toContain(join("tests", "e2e-tests"));
  });

  it("finds all non-node_modules lcov files when nothing is excluded", () => {
    const files: string[] = findLcovFiles(dir);
    expect(files).toHaveLength(2);
  });

  it("unions unit + e2e coverage of the same web file (line hit by either counts)", () => {
    const files: string[] = findLcovFiles(dir);
    const result = mergeLcovFiles(files);
    expect(result.fileCount).toBe(2);
    // One merged source file (App.tsx), both lines now covered.
    expect(result.merged.size).toBe(1);
    expect(result.summary.lines).toEqual({ found: 2, hit: 2 });
    expect(result.summary.functions).toEqual({ found: 1, hit: 1 });
  });

  it("hasSourceMatching detects web source presence", () => {
    const result = mergeLcovFiles(findLcovFiles(dir));
    expect(hasSourceMatching(result.merged, "packages/web/src")).toBe(true);
    expect(hasSourceMatching(result.merged, "packages/server/src")).toBe(false);
  });

  it("renders text and markdown summaries", () => {
    const result = mergeLcovFiles(findLcovFiles(dir));
    const text: string = renderTextTable(result, result.merged.size);
    expect(text).toContain("Lines:");
    expect(text).toContain("100.0%");
    const md: string = renderMarkdown(result, result.merged.size);
    expect(md).toContain("| Lines | 100.0% | 2 / 2 |");
    expect(md).toContain("Combined coverage");
  });

  it("returns empty for a directory with no lcov files", () => {
    const empty: string = mkdtempSync(join(tmpdir(), "covmerge-empty-"));
    try {
      expect(findLcovFiles(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
