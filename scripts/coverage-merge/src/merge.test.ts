import { describe, it, expect } from "vitest";

import {
  normalizeSourcePath,
  parseLcov,
  unionFileCoverage,
  mergeCoverageMaps,
  summarize,
  formatPercent,
  writeLcov,
  type FileCoverage,
} from "./merge.js";

describe("normalizeSourcePath", () => {
  it("strips an absolute POSIX CI prefix down to the repo anchor", () => {
    expect(normalizeSourcePath("/home/runner/work/grackle/grackle/packages/web/src/App.tsx")).toBe(
      "packages/web/src/App.tsx",
    );
  });

  it("strips an absolute Windows prefix and normalizes separators", () => {
    expect(normalizeSourcePath("C:\\Users\\nickp\\src\\grackle\\packages\\auth\\src\\key.ts")).toBe(
      "packages/auth/src/key.ts",
    );
  });

  it("leaves an already-relative repo path unchanged", () => {
    expect(normalizeSourcePath("packages/web/src/components/Foo.tsx")).toBe(
      "packages/web/src/components/Foo.tsx",
    );
  });

  it("uses the last anchor when one appears in the absolute prefix too", () => {
    expect(normalizeSourcePath("/home/packages/grackle/packages/web/src/x.ts")).toBe(
      "packages/web/src/x.ts",
    );
  });

  it("normalizes tests/ and scripts/ anchors", () => {
    expect(normalizeSourcePath("/abs/tests/e2e-tests/foo.ts")).toBe("tests/e2e-tests/foo.ts");
    expect(normalizeSourcePath("/abs/scripts/coverage-merge/src/index.ts")).toBe(
      "scripts/coverage-merge/src/index.ts",
    );
  });

  it("falls back to the cleaned path when no anchor is present", () => {
    expect(normalizeSourcePath("/opt/weird/file.ts")).toBe("/opt/weird/file.ts");
  });

  it("resolves a Vitest package-relative path against the lcov's package root", () => {
    // <pkg>/coverage/lcov.info → <pkg>, so src/foo.ts → packages/web/src/foo.ts.
    expect(normalizeSourcePath("src/App.tsx", "/abs/packages/web/coverage/lcov.info")).toBe(
      "packages/web/src/App.tsx",
    );
    expect(
      normalizeSourcePath(
        "src\\merge.ts",
        "C:\\repo\\scripts\\coverage-merge\\coverage\\lcov.info",
      ),
    ).toBe("scripts/coverage-merge/src/merge.ts");
  });

  it("ignores the lcov path when the SF is already repo-relative or absolute", () => {
    expect(
      normalizeSourcePath("packages/web/src/App.tsx", "/abs/tests/e2e-tests/coverage/lcov.info"),
    ).toBe("packages/web/src/App.tsx");
    expect(
      normalizeSourcePath("/x/packages/web/src/App.tsx", "/abs/tests/e2e-tests/coverage/lcov.info"),
    ).toBe("packages/web/src/App.tsx");
  });
});

describe("parseLcov", () => {
  const sample: string = [
    "TN:",
    "SF:/abs/packages/web/src/App.tsx",
    "FN:10,render",
    "FNDA:3,render",
    "FNF:1",
    "FNH:1",
    "BRDA:12,0,0,2",
    "BRDA:12,0,1,-",
    "BRF:2",
    "BRH:1",
    "DA:10,3",
    "DA:11,0",
    "LF:2",
    "LH:1",
    "end_of_record",
    "",
  ].join("\n");

  it("parses a single record keyed by normalized path", () => {
    const map = parseLcov(sample);
    expect([...map.keys()]).toEqual(["packages/web/src/App.tsx"]);
    const cov = map.get("packages/web/src/App.tsx")!;
    expect(cov.functionLines.get("render")).toBe(10);
    expect(cov.functionHits.get("render")).toBe(3);
    expect(cov.lineHits.get(10)).toBe(3);
    expect(cov.lineHits.get(11)).toBe(0);
    expect(cov.branchHits.get("12,0,0")).toBe(2);
    expect(cov.branchHits.get("12,0,1")).toBeUndefined();
  });

  it("handles function names containing commas", () => {
    const lcov = [
      "SF:packages/x/src/a.ts",
      "FN:1,Foo<A,B>",
      "FNDA:5,Foo<A,B>",
      "end_of_record",
    ].join("\n");
    const cov = parseLcov(lcov).get("packages/x/src/a.ts")!;
    expect(cov.functionLines.get("Foo<A,B>")).toBe(1);
    expect(cov.functionHits.get("Foo<A,B>")).toBe(5);
  });

  it("unions duplicate records for the same path within one file", () => {
    const lcov = [
      "SF:packages/x/src/a.ts",
      "DA:1,1",
      "end_of_record",
      "SF:/other/packages/x/src/a.ts",
      "DA:1,2",
      "DA:2,0",
      "end_of_record",
    ].join("\n");
    const cov = parseLcov(lcov).get("packages/x/src/a.ts")!;
    expect(cov.lineHits.get(1)).toBe(3);
    expect(cov.lineHits.get(2)).toBe(0);
  });

  it("returns an empty map for empty input", () => {
    expect(parseLcov("").size).toBe(0);
  });

  it("treats NaN in BRDA taken field as 0 (vitest 4.x coverage bug)", () => {
    const lcov = ["SF:packages/a/src/x.ts", "BRDA:5,0,0,NaN", "BRDA:5,0,1,3", "end_of_record"].join(
      "\n",
    );
    const cov = parseLcov(lcov).get("packages/a/src/x.ts")!;
    expect(cov.branchHits.get("5,0,0")).toBe(0);
    expect(cov.branchHits.get("5,0,1")).toBe(3);
  });
});

describe("unionFileCoverage", () => {
  it("sums line and function hits and merges branch taken counts", () => {
    const a: FileCoverage = {
      path: "packages/web/src/App.tsx",
      functionLines: new Map([["render", 10]]),
      functionHits: new Map([["render", 0]]),
      lineHits: new Map([
        [10, 0],
        [11, 1],
      ]),
      branchHits: new Map([["12,0,0", undefined]]),
    };
    const b: FileCoverage = {
      path: "packages/web/src/App.tsx",
      functionLines: new Map([["render", 10]]),
      functionHits: new Map([["render", 4]]),
      lineHits: new Map([[10, 2]]),
      branchHits: new Map([["12,0,0", 3]]),
    };
    const merged = unionFileCoverage(a, b);
    expect(merged.functionHits.get("render")).toBe(4);
    expect(merged.lineHits.get(10)).toBe(2);
    expect(merged.lineHits.get(11)).toBe(1);
    expect(merged.branchHits.get("12,0,0")).toBe(3);
  });
});

describe("mergeCoverageMaps + summarize", () => {
  it("unions overlapping web coverage from unit and e2e (a line hit by either counts)", () => {
    // Unit covers line 10 of App; E2E covers line 11. Union => both lines hit.
    const unit = parseLcov(
      ["SF:packages/web/src/App.tsx", "DA:10,1", "DA:11,0", "end_of_record"].join("\n"),
    );
    const e2e = parseLcov(
      ["SF:/runner/packages/web/src/App.tsx", "DA:10,0", "DA:11,5", "end_of_record"].join("\n"),
    );
    const merged = mergeCoverageMaps([unit, e2e]);
    expect(merged.size).toBe(1);
    const summary = summarize(merged);
    expect(summary.lines).toEqual({ found: 2, hit: 2 });
  });

  it("keeps non-overlapping files separate and sums totals", () => {
    const a = parseLcov(["SF:packages/a/src/x.ts", "DA:1,1", "end_of_record"].join("\n"));
    const b = parseLcov(["SF:packages/b/src/y.ts", "DA:1,0", "end_of_record"].join("\n"));
    const summary = summarize(mergeCoverageMaps([a, b]));
    expect(summary.lines).toEqual({ found: 2, hit: 1 });
  });

  it("counts function and branch coverage across the union", () => {
    const m = parseLcov(
      [
        "SF:packages/a/src/x.ts",
        "FN:1,f",
        "FNDA:0,f",
        "FN:2,g",
        "FNDA:2,g",
        "BRDA:3,0,0,1",
        "BRDA:3,0,1,0",
        "DA:1,0",
        "end_of_record",
      ].join("\n"),
    );
    const summary = summarize(m);
    expect(summary.functions).toEqual({ found: 2, hit: 1 });
    expect(summary.branches).toEqual({ found: 2, hit: 1 });
  });
});

describe("formatPercent", () => {
  it("formats to one decimal place", () => {
    expect(formatPercent({ found: 1000, hit: 831 })).toBe("83.1%");
    expect(formatPercent({ found: 3, hit: 3 })).toBe("100.0%");
  });

  it("returns n/a for an empty metric", () => {
    expect(formatPercent({ found: 0, hit: 0 })).toBe("n/a");
  });
});

describe("writeLcov", () => {
  it("round-trips through parseLcov with recomputed counters", () => {
    const original = parseLcov(
      [
        "SF:packages/web/src/App.tsx",
        "FN:10,render",
        "FNDA:3,render",
        "BRDA:12,0,0,2",
        "BRDA:12,0,1,-",
        "DA:10,3",
        "DA:11,0",
        "end_of_record",
      ].join("\n"),
    );
    const text = writeLcov(original);
    expect(text).toContain("SF:packages/web/src/App.tsx");
    expect(text).toContain("LF:2");
    expect(text).toContain("LH:1");
    expect(text).toContain("FNF:1");
    expect(text).toContain("FNH:1");
    expect(text).toContain("BRF:2");
    expect(text).toContain("BRH:1");
    // Re-parsing the serialized output yields identical coverage.
    const reparsed = parseLcov(text);
    expect(summarize(reparsed)).toEqual(summarize(original));
  });

  it("emits deterministic sorted output and empty string for empty input", () => {
    expect(writeLcov(new Map())).toBe("");
  });
});
