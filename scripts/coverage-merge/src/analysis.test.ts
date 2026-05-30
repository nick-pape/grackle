import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  classifySuite,
  packageKey,
  analyzeCoverage,
  summarizeByPackage,
  checkCombinedThresholds,
  renderPerPackageMarkdown,
  type CombinedFloor,
} from "./run.js";

describe("classifySuite", () => {
  it("tags storybook, e2e (browser + backend), and unit by path", () => {
    expect(
      classifySuite("coverage-input/unit/packages/web-components/coverage-storybook/lcov.info"),
    ).toBe("storybook");
    expect(classifySuite("coverage-input/e2e/e2e-coverage-chromium-1/coverage/lcov.info")).toBe(
      "e2e",
    );
    expect(
      classifySuite("coverage-input/e2e/e2e-coverage-knowledge/coverage-backend/lcov.info"),
    ).toBe("e2e");
    expect(classifySuite("coverage-input/unit/packages/web/coverage/lcov.info")).toBe("unit");
    // local paths
    expect(classifySuite("tests/e2e-tests/coverage/lcov.info")).toBe("e2e");
    expect(classifySuite("packages/web-components/coverage-storybook/lcov.info")).toBe("storybook");
    expect(classifySuite("packages/core/coverage/lcov.info")).toBe("unit");
  });
});

describe("packageKey", () => {
  it("extracts packages/<pkg> and scripts/<pkg>, else undefined", () => {
    expect(packageKey("packages/web-components/src/x.tsx")).toBe("packages/web-components");
    expect(packageKey("scripts/coverage-merge/src/x.ts")).toBe("scripts/coverage-merge");
    expect(packageKey("rigs/heft-rig/x.ts")).toBeUndefined();
  });
});

describe("analyzeCoverage + summarizeByPackage (real files)", () => {
  let dir: string;
  // unit covers App line 10; e2e covers line 11 — combined = both lines.
  const unit = ["SF:src/App.tsx", "DA:10,1", "DA:11,0", "end_of_record", ""].join("\n");
  const e2e = ["SF:packages/web/src/App.tsx", "DA:10,0", "DA:11,3", "end_of_record", ""].join("\n");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cov-an-"));
    mkdirSync(join(dir, "unit", "packages", "web", "coverage"), { recursive: true });
    mkdirSync(join(dir, "e2e", "shard1", "coverage"), { recursive: true });
    writeFileSync(join(dir, "unit", "packages", "web", "coverage", "lcov.info"), unit);
    writeFileSync(join(dir, "e2e", "shard1", "coverage", "lcov.info"), e2e);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("separates per-suite and unions into combined", () => {
    const files = [
      join(dir, "unit", "packages", "web", "coverage", "lcov.info"),
      join(dir, "e2e", "shard1", "coverage", "lcov.info"),
    ];
    const a = analyzeCoverage(files);
    // both resolve to packages/web/src/App.tsx
    expect([...a.combined.keys()]).toEqual(["packages/web/src/App.tsx"]);
    expect(a.summary.lines).toEqual({ found: 2, hit: 2 }); // unit hit 10, e2e hit 11

    const unitPkg = summarizeByPackage(a.bySuite.unit).get("packages/web");
    const e2ePkg = summarizeByPackage(a.bySuite.e2e).get("packages/web");
    const combPkg = summarizeByPackage(a.combined).get("packages/web");
    expect(unitPkg!.lines).toEqual({ found: 2, hit: 1 }); // unit: only line 10
    expect(e2ePkg!.lines).toEqual({ found: 2, hit: 1 }); // e2e: only line 11
    expect(combPkg!.lines).toEqual({ found: 2, hit: 2 }); // union: both
  });

  it("renders a per-package table with per-suite + combined", () => {
    const files = [
      join(dir, "unit", "packages", "web", "coverage", "lcov.info"),
      join(dir, "e2e", "shard1", "coverage", "lcov.info"),
    ];
    const md = renderPerPackageMarkdown(analyzeCoverage(files));
    expect(md).toContain("| packages/web |");
    expect(md).toContain("**100.0%**"); // combined lines
  });
});

describe("checkCombinedThresholds", () => {
  const summaries = (lines: number, fns: number, br: number) =>
    new Map([
      [
        "packages/web",
        {
          lines: { found: 100, hit: lines },
          functions: { found: 100, hit: fns },
          branches: { found: 100, hit: br },
        },
      ],
    ]);

  it("passes when all metrics meet the floor", () => {
    const floors: Record<string, CombinedFloor> = {
      "packages/web": { lines: 30, functions: 40, branches: 20 },
    };
    const { violations, enforcedCount, missingCoverage } = checkCombinedThresholds(
      summaries(35, 45, 25),
      floors,
    );
    expect(violations).toHaveLength(0);
    expect(enforcedCount).toBe(1);
    expect(missingCoverage).toEqual([]);
  });

  it("flags each metric below its floor", () => {
    const floors: Record<string, CombinedFloor> = {
      "packages/web": { lines: 40, functions: 40, branches: 30 },
    };
    const { violations } = checkCombinedThresholds(summaries(35, 45, 25), floors);
    expect(violations.map((v) => v.message)).toEqual([
      "packages/web lines 35.0% < floor 40%",
      "packages/web branches 25.0% < floor 30%",
    ]);
  });

  it("reports floors with no coverage as missingCoverage, and coverage with no floor as unenforced", () => {
    const floors: Record<string, CombinedFloor> = {
      "packages/absent": { lines: 90, functions: 90, branches: 90 },
    };
    const { violations, unenforced, missingCoverage, enforcedCount } = checkCombinedThresholds(
      summaries(35, 45, 25),
      floors,
    );
    expect(violations).toHaveLength(0); // packages/absent has no coverage → not a violation
    expect(missingCoverage).toEqual(["packages/absent"]); // floor entry, no coverage
    expect(unenforced).toEqual(["packages/web"]); // has coverage, no floor entry
    expect(enforcedCount).toBe(0); // nothing was actually enforced
  });
});
