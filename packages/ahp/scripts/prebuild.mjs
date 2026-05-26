/**
 * Prebuild script: clones Microsoft's Agent Host Protocol `types/` directory,
 * applies transforms, and writes clean `.ts` files into `src/vendor/ahp/`.
 *
 * Transforms applied (per the spike's requirements):
 * 1. Prepend eslint-disable header to every `.ts` file.
 * 2. Strip upstream test files (vitest runner conflict).
 * 3. Remove upstream `tsconfig.json` (we compile under our own).
 * 4. Convert `const enum` to plain `enum` (esbuild compatibility).
 *
 * The upstream conformance corpus under `test-cases/reducers/*.json`
 * is kept for `reducer-conformance.test.ts`.
 *
 * This script runs from a temporary clone directory; nothing is left behind
 * after the build. The output lives in `src/vendor/ahp/` alongside our
 * hand-written `src/index.ts` and other sources.
 */

import { cp, mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// ─── Config ────────────────────────────────────────────────────────────

const AHP_REPO_URL = "https://github.com/microsoft/agent-host-protocol.git";
const AHP_COMMIT = "7c6b727bde61bc2c490201fb0e47a86759172782";
const TYPES_SUBDIR = "types";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(SCRIPT_DIR, "..", "src", "vendor", "ahp");
const TMP_DIR = join(SCRIPT_DIR, "..", ".tmp-ahp-clone");

// Files/dirs in types/ to skip entirely
const SKIP_ITEMS = ["scripts", "plugins", "docs"];

// ─── Helpers ───────────────────────────────────────────────────────────

async function copyFile(src, dest) {
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest);
}

async function copyDir(src, dest, isRoot = false) {
  await mkdir(dirname(dest), { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    // Skip upstream test files
    if (entry.name.endsWith(".test.ts")) {
      continue;
    }

    // Skip excluded top-level items only at the root of the types/ directory
    if (isRoot && SKIP_ITEMS.includes(entry.name)) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, false);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

async function prependHeader(filePath, header) {
  const content = await readFile(filePath, "utf-8");
  await writeFile(filePath, header + "\n" + content);
}

async function convertConstEnum(filePath) {
  const content = await readFile(filePath, "utf-8");
  const transformed = content.replace(/const\s+enum\s+/g, "enum ");
  if (transformed !== content) {
    await writeFile(filePath, transformed);
  }
}

async function transformFile(filePath) {
  const header = "/* eslint-disable -- vendored third-party code, see SOURCE.md */";
  await prependHeader(filePath, header);
  await convertConstEnum(filePath);
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  // Clean up any previous clone
  if (existsSync(TMP_DIR)) {
    await rm(TMP_DIR, { recursive: true, force: true });
  }

  // Clone the AHP repo at the pinned commit (shallow clone directly to the commit)
  console.log(`Cloning ${AHP_REPO_URL} @ ${AHP_COMMIT} into ${TMP_DIR}...`);
  execFileSync(
    "git",
    [
      "clone",
      "--depth", "1",
      "--single-branch",
      AHP_REPO_URL,
      TMP_DIR,
    ],
    { stdio: "inherit" },
  );

  // Fetch and checkout the specific commit (shallow clone may not have it)
  console.log(`Fetching commit ${AHP_COMMIT}...`);
  execFileSync(
    "git",
    ["fetch", "--depth", "1", "origin", AHP_COMMIT],
    { cwd: TMP_DIR, stdio: "inherit" },
  );
  console.log(`Checking out ${AHP_COMMIT}...`);
  execFileSync(
    "git",
    ["checkout", AHP_COMMIT],
    { cwd: TMP_DIR, stdio: "inherit" },
  );

  // Clean up output dir
  if (existsSync(OUTPUT_DIR)) {
    await rm(OUTPUT_DIR, { recursive: true, force: true });
  }
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Copy the types/ directory with transforms
  const srcTypesDir = join(TMP_DIR, TYPES_SUBDIR);
  console.log(`Copying ${TYPES_SUBDIR}/ -> ${OUTPUT_DIR} with transforms...`);
  await copyDir(srcTypesDir, OUTPUT_DIR, true);

  // Apply eslint-disable headers + const enum -> enum to all .ts files
  console.log("Applying eslint-disable headers and const enum transforms...");
  const tsFiles = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (extname(entry.name) === ".ts") {
        tsFiles.push(fullPath);
      }
    }
  }

  await walk(OUTPUT_DIR);

  // Skip tsconfig.json if it exists (we don't compile vendored tsconfig)
  const tsconfigPath = join(OUTPUT_DIR, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    await rm(tsconfigPath);
  }

  for (const file of tsFiles) {
    await transformFile(file);
  }

  // Write SOURCE.md with metadata
  const sourceMd = `# Vendored: Agent Host Protocol types

This directory is the \`types/\` tree cloned from Microsoft's Agent Host
Protocol repository, used by \`@grackle-ai/ahp\` - a publishable npm package
that builds from upstream via a prebuild transform step. It is third-party
code - **do not edit it directly**; update the pinned commit or transforms
in \`scripts/prebuild.mjs\` if upstream changes are needed.

- **Source:** https://github.com/microsoft/agent-host-protocol
- **Path:** \`types/\`
- **Pinned commit:** \`${AHP_COMMIT}\`
  (\`Add ahp-otlp: telemetry channel for OpenTelemetry pass-through (#140)\`)
- **License:** MIT (C) Microsoft Corporation

## Local transforms (applied by \`scripts/prebuild.mjs\`)

1. A \`/* eslint-disable -- vendored third-party code, see SOURCE.md */\` header
   was prepended to every \`.ts\` file so the repo's \`@rushstack\` lint rules do
   not flag third-party style (warnings fail CI).
2. Upstream \`.test.ts\` files were removed (they run on \`node:test\`/\`tsx\`,
   which would conflict with this package's vitest runner). The reducer
   conformance corpus under \`test-cases/reducers/*.json\` is **kept** and
   exercised by \`src/reducer-conformance.test.ts\`.
3. The upstream \`tsconfig.json\` was removed; this package compiles the
   vendored sources under its own \`tsconfig.json\`.
4. Every \`const enum\` was converted to a plain \`enum\`. The string values
   are identical, but plain enums emit a runtime object, so they work both
   under tsc (heft build) and under esbuild (the vitest runner) - cross-file
   \`const enum\` access is not reliably emitted by esbuild and would be
   \`undefined\` at runtime.

The load-bearing pieces the package consumes: \`reducers.ts\` (re-exports the
pure channel reducers), \`channels-session/{state,actions,reducer}.ts\`,
\`common/*\`, and \`action-origin.generated.ts\`.
`;
  await writeFile(join(OUTPUT_DIR, "SOURCE.md"), sourceMd);

  // Cleanup clone
  await rm(TMP_DIR, { recursive: true, force: true });

  console.log(`Done. Vendored AHP types written to ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error("Prebuild failed:", err);
  process.exit(1);
});
