#!/usr/bin/env node
// Thin wrapper around Prettier used by Rush custom commands and the pre-commit hook.
//
// Usage:
//   format.js <write|check> --all
//   format.js <write|check> --changed <baseRef>
//   format.js <write|check> --staged
//   format.js <write|check> --files <file1> <file2> ...
//
// Always passes Prettier's --cache (metadata strategy) for sub-second incremental runs.

"use strict";

const { spawnSync, execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PRETTIER_BIN = require.resolve("prettier/bin/prettier.cjs");
const CACHE_DIR = path.join(REPO_ROOT, "common", "temp", "prettier-cache");

const FORMATTABLE_EXT = /\.(ts|tsx|js|jsx|cjs|mjs|json|md|ya?ml|css)$/i;

function usage(msg) {
  if (msg) {
    process.stderr.write(`format.js: ${msg}\n`);
  }
  process.stderr.write(
    "Usage: format.js <write|check> [--all | --changed <baseRef> | --staged | --files <files...>]\n",
  );
  process.exit(2);
}

// Parse argv. Scope flags use a precedence (highest first):
//   --files > --all > --staged > --changed
// This lets a wrapper hardcode `--changed origin/main` and still allow
// the user to escalate with `--all` from the Rush command line.
function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0) {
    usage("missing mode");
  }
  const mode = args.shift();
  if (mode !== "write" && mode !== "check") {
    usage(`unknown mode "${mode}"`);
  }
  const seen = new Set();
  let baseRef = null;
  let files = [];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--all") {
      seen.add("all");
    } else if (arg === "--staged") {
      seen.add("staged");
    } else if (arg === "--changed") {
      seen.add("changed");
      baseRef = args.shift();
      if (!baseRef) {
        usage("--changed requires a base ref");
      }
    } else if (arg === "--files") {
      seen.add("files");
      files = args.slice();
      args.length = 0;
    } else {
      usage(`unknown argument "${arg}"`);
    }
  }
  if (seen.size === 0) {
    usage("missing scope (--all, --changed, --staged, or --files)");
  }
  const scope = seen.has("files")
    ? "files"
    : seen.has("all")
      ? "all"
      : seen.has("staged")
        ? "staged"
        : "changed";
  return { mode, scope, baseRef, files };
}

function gitFiles(args) {
  try {
    const out = execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.split("\n").filter(Boolean);
  } catch (err) {
    process.stderr.write(`format.js: git ${args.join(" ")} failed: ${err.message}\n`);
    process.exit(1);
  }
}

function collectFiles({ scope, baseRef, files }) {
  switch (scope) {
    case "all":
      return null; // signal "run on '.'"
    case "staged":
      return gitFiles(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).filter((f) =>
        FORMATTABLE_EXT.test(f),
      );
    case "changed": {
      // Resolve baseRef to a SHA so the ...HEAD diff is stable even after rebases.
      const tripleDot = `${baseRef}...HEAD`;
      const changed = gitFiles(["diff", "--name-only", "--diff-filter=ACMR", tripleDot]);
      return changed.filter((f) => FORMATTABLE_EXT.test(f));
    }
    case "files":
      return files.filter((f) => FORMATTABLE_EXT.test(f));
    default:
      usage(`unknown scope "${scope}"`);
      return [];
  }
}

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Windows' CreateProcess command-line limit is ~32 KB. Keep each spawn well
// under that so chunked invocations never overflow.
const MAX_ARGV_BYTES = 24000;

function baseArgs(mode) {
  return [
    PRETTIER_BIN,
    "--cache",
    "--cache-location",
    path.join(CACHE_DIR, "cache"),
    "--cache-strategy",
    "metadata",
    "--log-level",
    "warn",
    mode === "write" ? "--write" : "--check",
  ];
}

function chunkFiles(files, fixedArgs) {
  const fixedLen = fixedArgs.reduce((n, a) => n + Buffer.byteLength(a) + 1, 0);
  const chunks = [];
  let current = [];
  let currentLen = fixedLen;
  for (const f of files) {
    const flen = Buffer.byteLength(f) + 1;
    if (current.length > 0 && currentLen + flen > MAX_ARGV_BYTES) {
      chunks.push(current);
      current = [];
      currentLen = fixedLen;
    }
    current.push(f);
    currentLen += flen;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

function spawnPrettier(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (result.error) {
    process.stderr.write(`format.js: failed to spawn prettier: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function runPrettier(mode, fileList) {
  ensureCacheDir();
  const fixed = baseArgs(mode);
  if (fileList === null) {
    // Whole repo; rely on .prettierignore for exclusions.
    return spawnPrettier([...fixed, "."]);
  }
  if (fileList.length === 0) {
    process.stdout.write("format.js: no formattable files in scope.\n");
    return 0;
  }
  const chunks = chunkFiles(fileList, fixed);
  let worstStatus = 0;
  for (const chunk of chunks) {
    const status = spawnPrettier([...fixed, ...chunk]);
    // Aggregate: any non-zero status survives. Prefer the highest (1 = format
    // issues, 2 = config / usage error) so callers see the most serious result.
    if (status > worstStatus) {
      worstStatus = status;
    }
  }
  return worstStatus;
}

function main() {
  const { mode, scope, baseRef, files } = parseArgs(process.argv);
  const list = collectFiles({ scope, baseRef, files });
  const code = runPrettier(mode, list);
  process.exit(code);
}

main();
