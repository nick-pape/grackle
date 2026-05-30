// Pure functions for unioning lcov coverage across multiple test suites
// (Vitest unit, Storybook interaction, Playwright E2E) into one repo-wide
// total. Kept free of any filesystem/CLI concerns so they are trivially
// unit-testable; the I/O wrapper lives in `index.ts`.
//
// Why union (not concat): the same source file is exercised by several suites
// (e.g. `packages/web/src/...` is hit by both unit tests and E2E). A line is
// "covered" if ANY suite executed it, so per-line/-function/-branch hit counts
// are summed and a line counts as hit when its total is > 0.

/** Top-level repo directories that anchor a repo-relative source path. */
const REPO_ANCHORS: readonly string[] = ["packages", "scripts", "tests", "apps", "rigs"];

/** Per-file coverage extracted from (and re-emitted to) lcov. */
export interface FileCoverage {
  /** Repo-root-relative POSIX path, e.g. `packages/web/src/App.tsx`. */
  path: string;
  /** Function definition line keyed by function name (from `FN:`). */
  functionLines: Map<string, number>;
  /** Execution count keyed by function name (from `FNDA:`). */
  functionHits: Map<string, number>;
  /** Execution count keyed by line number (from `DA:`). */
  lineHits: Map<number, number>;
  /**
   * Branch "taken" counts keyed by `line,block,branch` (from `BRDA:`). A value
   * of `undefined` represents lcov's `-` (branch never reached), distinct from
   * `0` (reached but this path not taken).
   */
  branchHits: Map<string, number | undefined>;
}

/** Aggregate hit/found totals for one coverage metric. */
export interface MetricTotal {
  /** Number of distinct items (lines, functions, or branches) found. */
  found: number;
  /** Number of those items hit at least once. */
  hit: number;
}

/** Repo-wide coverage totals across lines, functions, and branches. */
export interface CoverageSummary {
  lines: MetricTotal;
  functions: MetricTotal;
  branches: MetricTotal;
}

/** Take the substring beginning at the last top-level repo anchor, else return unchanged. */
function stripToAnchor(posix: string): string {
  let anchorIndex: number = -1;
  for (const anchor of REPO_ANCHORS) {
    const needle: string = `/${anchor}/`;
    const idx: number = posix.lastIndexOf(needle);
    if (idx !== -1 && idx + 1 > anchorIndex) {
      // +1 to skip the leading slash so the result starts with the anchor.
      anchorIndex = idx + 1;
    }
    // Also handle a path that already starts with the anchor (no leading slash).
    if (anchorIndex === -1 && posix.startsWith(`${anchor}/`)) {
      anchorIndex = 0;
    }
  }
  return anchorIndex >= 0 ? posix.slice(anchorIndex) : posix;
}

/** Return the parent directory of a POSIX path (empty string at the root). */
function parentDir(posix: string): string {
  const idx: number = posix.lastIndexOf("/");
  return idx <= 0 ? "" : posix.slice(0, idx);
}

/**
 * Normalize an lcov `SF:` path to a repo-root-relative POSIX path so the same
 * source file produces an identical key regardless of which suite emitted it.
 *
 * Two source conventions are reconciled:
 *  - **Absolute or already-repo-relative** paths (Playwright E2E via monocart
 *    emits `packages/web/src/...`; some reporters emit absolute CI paths) are
 *    reduced to the substring at the last repo anchor (`packages/`, ...).
 *  - **Package-relative** paths (Vitest's v8 lcov writes `src/foo.ts` relative
 *    to the package dir) are resolved against the package root inferred from the
 *    lcov file's location (`<pkg>/coverage/lcov.info` → `<pkg>`), then anchored.
 *
 * @param sfPath - The raw path from an lcov `SF:` line.
 * @param lcovFilePath - Path of the lcov file the `SF:` came from, used to
 *   resolve package-relative paths. Optional (best-effort when omitted).
 * @returns The repo-relative POSIX path.
 */
export function normalizeSourcePath(sfPath: string, lcovFilePath?: string): string {
  const posix: string = sfPath.replace(/\\/g, "/").trim();
  const anchored: string = stripToAnchor(posix);
  // An anchor was found (repo-relative or absolute-with-anchor), or the path is
  // absolute — use the anchored form directly.
  if (anchored !== posix || posix.startsWith("/") || /^[a-zA-Z]:\//.test(posix)) {
    return anchored;
  }
  // Package-relative (e.g. Vitest's `src/foo.ts`): resolve against the package
  // root derived from `<pkg>/coverage/lcov.info`.
  if (lcovFilePath) {
    const lcovPosix: string = lcovFilePath.replace(/\\/g, "/");
    const pkgRoot: string = parentDir(parentDir(lcovPosix));
    if (pkgRoot.length > 0) {
      return stripToAnchor(`${pkgRoot}/${posix}`);
    }
  }
  return anchored;
}

/**
 * Parse lcov text into per-file coverage keyed by normalized source path.
 * Records for the same path appearing more than once (within or across files)
 * are merged via {@link unionFileCoverage}.
 *
 * @param lcov - The contents of an `lcov.info` file.
 * @param lcovFilePath - Path of the file (used to resolve package-relative
 *   `SF:` paths like Vitest's `src/foo.ts`). Optional.
 * @returns A map of normalized source path to its parsed coverage.
 */
export function parseLcov(lcov: string, lcovFilePath?: string): Map<string, FileCoverage> {
  const files: Map<string, FileCoverage> = new Map();
  let current: FileCoverage | undefined;

  for (const rawLine of lcov.split(/\r?\n/)) {
    const line: string = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const colon: number = line.indexOf(":");
    const tag: string = colon === -1 ? line : line.slice(0, colon);
    const value: string = colon === -1 ? "" : line.slice(colon + 1);

    switch (tag) {
      case "SF": {
        current = {
          path: normalizeSourcePath(value, lcovFilePath),
          functionLines: new Map(),
          functionHits: new Map(),
          lineHits: new Map(),
          branchHits: new Map(),
        };
        break;
      }
      case "FN": {
        // FN:<line>,<name> (name may itself contain commas, so split once).
        if (current) {
          const comma: number = value.indexOf(",");
          if (comma !== -1) {
            const defLine: number = Number.parseInt(value.slice(0, comma), 10);
            const name: string = value.slice(comma + 1);
            if (!Number.isNaN(defLine)) {
              current.functionLines.set(name, defLine);
            }
          }
        }
        break;
      }
      case "FNDA": {
        // FNDA:<hits>,<name>
        if (current) {
          const comma: number = value.indexOf(",");
          if (comma !== -1) {
            const hits: number = Number.parseInt(value.slice(0, comma), 10);
            const name: string = value.slice(comma + 1);
            const prev: number = current.functionHits.get(name) ?? 0;
            current.functionHits.set(name, prev + (Number.isNaN(hits) ? 0 : hits));
          }
        }
        break;
      }
      case "DA": {
        // DA:<line>,<hits>[,<checksum>]
        if (current) {
          const parts: string[] = value.split(",");
          const lineNo: number = Number.parseInt(parts[0], 10);
          const hits: number = Number.parseInt(parts[1], 10);
          if (!Number.isNaN(lineNo)) {
            const prev: number = current.lineHits.get(lineNo) ?? 0;
            current.lineHits.set(lineNo, prev + (Number.isNaN(hits) ? 0 : hits));
          }
        }
        break;
      }
      case "BRDA": {
        // BRDA:<line>,<block>,<branch>,<taken> where taken is a number or "-".
        if (current) {
          const parts: string[] = value.split(",");
          if (parts.length >= 4) {
            const key: string = `${parts[0]},${parts[1]},${parts[2]}`;
            const takenRaw: string = parts[3];
            const taken: number | undefined =
              takenRaw === "-" ? undefined : Number.parseInt(takenRaw, 10);
            const prev: number | undefined = current.branchHits.get(key);
            current.branchHits.set(key, addBranchTaken(prev, taken));
          }
        }
        break;
      }
      case "end_of_record": {
        if (current) {
          const existing: FileCoverage | undefined = files.get(current.path);
          files.set(current.path, existing ? unionFileCoverage(existing, current) : current);
          current = undefined;
        }
        break;
      }
      default: {
        // LF/LH/FNF/FNH/BRF/BRH/TN are recomputed on write — ignore on read.
        break;
      }
    }
  }

  return files;
}

/** Sum two lcov branch "taken" values, preserving `-` (undefined) only when both are unreached. */
function addBranchTaken(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) {
    return undefined;
  }
  return (a ?? 0) + (b ?? 0);
}

/** Union two coverage records for the same source file (sum all hit counts). */
export function unionFileCoverage(a: FileCoverage, b: FileCoverage): FileCoverage {
  const merged: FileCoverage = {
    path: a.path,
    functionLines: new Map(a.functionLines),
    functionHits: new Map(a.functionHits),
    lineHits: new Map(a.lineHits),
    branchHits: new Map(a.branchHits),
  };
  for (const [name, defLine] of b.functionLines) {
    merged.functionLines.set(name, defLine);
  }
  for (const [name, hits] of b.functionHits) {
    merged.functionHits.set(name, (merged.functionHits.get(name) ?? 0) + hits);
  }
  for (const [lineNo, hits] of b.lineHits) {
    merged.lineHits.set(lineNo, (merged.lineHits.get(lineNo) ?? 0) + hits);
  }
  for (const [key, taken] of b.branchHits) {
    merged.branchHits.set(key, addBranchTaken(merged.branchHits.get(key), taken));
  }
  return merged;
}

/** Union many parsed lcov maps into one, merging records that share a path. */
export function mergeCoverageMaps(
  maps: ReadonlyArray<Map<string, FileCoverage>>,
): Map<string, FileCoverage> {
  const result: Map<string, FileCoverage> = new Map();
  for (const map of maps) {
    for (const [path, cov] of map) {
      const existing: FileCoverage | undefined = result.get(path);
      result.set(path, existing ? unionFileCoverage(existing, cov) : cov);
    }
  }
  return result;
}

/** Compute repo-wide line/function/branch totals from merged coverage. */
export function summarize(files: Map<string, FileCoverage>): CoverageSummary {
  const summary: CoverageSummary = {
    lines: { found: 0, hit: 0 },
    functions: { found: 0, hit: 0 },
    branches: { found: 0, hit: 0 },
  };
  for (const cov of files.values()) {
    for (const hits of cov.lineHits.values()) {
      summary.lines.found += 1;
      if (hits > 0) {
        summary.lines.hit += 1;
      }
    }
    for (const hits of cov.functionHits.values()) {
      summary.functions.found += 1;
      if (hits > 0) {
        summary.functions.hit += 1;
      }
    }
    for (const taken of cov.branchHits.values()) {
      summary.branches.found += 1;
      if (taken !== undefined && taken > 0) {
        summary.branches.hit += 1;
      }
    }
  }
  return summary;
}

/** Format a {@link MetricTotal} as a percentage string with one decimal (e.g. `83.1%`). */
export function formatPercent(metric: MetricTotal): string {
  const PERCENT_DECIMALS: number = 1;
  if (metric.found === 0) {
    return "n/a";
  }
  return `${((metric.hit / metric.found) * 100).toFixed(PERCENT_DECIMALS)}%`;
}

/**
 * Serialize merged coverage back to lcov text. Files are emitted in sorted path
 * order for deterministic output; the recomputed `LF/LH/FNF/FNH/BRF/BRH`
 * counters reflect the unioned totals.
 */
export function writeLcov(files: Map<string, FileCoverage>): string {
  const out: string[] = [];
  const sortedPaths: string[] = [...files.keys()].sort();
  for (const path of sortedPaths) {
    const cov: FileCoverage = files.get(path)!;
    out.push("TN:");
    out.push(`SF:${path}`);

    const fnNames: string[] = [...cov.functionLines.keys()].sort();
    for (const name of fnNames) {
      out.push(`FN:${cov.functionLines.get(name)!},${name}`);
    }
    let fnHit: number = 0;
    for (const name of fnNames) {
      const hits: number = cov.functionHits.get(name) ?? 0;
      out.push(`FNDA:${hits},${name}`);
      if (hits > 0) {
        fnHit += 1;
      }
    }
    out.push(`FNF:${fnNames.length}`);
    out.push(`FNH:${fnHit}`);

    const branchKeys: string[] = [...cov.branchHits.keys()].sort(compareBranchKeys);
    let brHit: number = 0;
    for (const key of branchKeys) {
      const taken: number | undefined = cov.branchHits.get(key);
      out.push(`BRDA:${key},${taken === undefined ? "-" : taken}`);
      if (taken !== undefined && taken > 0) {
        brHit += 1;
      }
    }
    out.push(`BRF:${branchKeys.length}`);
    out.push(`BRH:${brHit}`);

    const lineNumbers: number[] = [...cov.lineHits.keys()].sort((x, y) => x - y);
    let lineHit: number = 0;
    for (const lineNo of lineNumbers) {
      const hits: number = cov.lineHits.get(lineNo) ?? 0;
      out.push(`DA:${lineNo},${hits}`);
      if (hits > 0) {
        lineHit += 1;
      }
    }
    out.push(`LF:${lineNumbers.length}`);
    out.push(`LH:${lineHit}`);
    out.push("end_of_record");
  }
  return out.join("\n") + (out.length > 0 ? "\n" : "");
}

/** Sort `line,block,branch` branch keys numerically by each component. */
function compareBranchKeys(a: string, b: string): number {
  const pa: number[] = a.split(",").map((n) => Number.parseInt(n, 10));
  const pb: number[] = b.split(",").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < pa.length; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }
  return 0;
}
