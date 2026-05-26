/**
 * Prebuild script: reads Microsoft's Agent Host Protocol `types/` directory
 * from the `agent-host-protocol` git dependency in node_modules, applies
 * transforms, and writes clean `.ts` files into `src/vendor/ahp/`.
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
 * The `agent-host-protocol` git dependency in package.json handles cloning;
 * this script only reads, transforms, and writes the output.
 */

import { cp, mkdir, rm, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Config ────────────────────────────────────────────────────────────

const TYPES_SUBDIR = "types";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NODE_MODULES_DIR = join(SCRIPT_DIR, "..", "node_modules");
const OUTPUT_DIR = join(SCRIPT_DIR, "..", "src", "vendor", "ahp");
const SRC_TYPES_DIR = join(NODE_MODULES_DIR, "agent-host-protocol", TYPES_SUBDIR);

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
  // Verify the git dependency is installed
  if (!(await stat(SRC_TYPES_DIR).then(() => true).catch(() => false))) {
    console.error(
      `Prebuild failed: "${TYPES_SUBDIR}/" not found at ${SRC_TYPES_DIR}. ` +
        "Run \`rush install\` to install the agent-host-protocol git dependency.",
    );
    process.exit(1);
  }

  // Clean up output dir
  if (dirname(OUTPUT_DIR) !== NODE_MODULES_DIR) {
    await rm(OUTPUT_DIR, { recursive: true, force: true });
  }
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Copy the types/ directory with transforms
  console.log(`Copying ${TYPES_SUBDIR}/ -> ${OUTPUT_DIR} with transforms...`);
  await copyDir(SRC_TYPES_DIR, OUTPUT_DIR, true);

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
  try {
    await stat(tsconfigPath);
    await rm(tsconfigPath);
  } catch {
    // not present — nothing to remove
  }

  for (const file of tsFiles) {
    await transformFile(file);
  }

  // Read the pinned commit from the git dependency's package.json for SOURCE.md
  const depPackageJson = join(NODE_MODULES_DIR, "agent-host-protocol", "package.json");
  const depPkg = JSON.parse(await readFile(depPackageJson, "utf-8"));
  const ahpRepoUrl = depPkg.repository?.url?.replace(/^git\+/, "").replace(/\.git$/, "") || "https://github.com/microsoft/agent-host-protocol";

  // Determine commit from the git dependency installation metadata
  // npm stores the resolved commit in the package.json's "resolved" or "commit" field
  // for git: dependencies. Fall back to git rev-parse on the node_modules dir.
  let ahpCommit = depPkg.commit || depPkg.resolved?.split("#")[1];
  if (!ahpCommit) {
    // Read from npm's metadata: node_modules/.package-lock.json or similar
    // For git: deps, the commit hash is in the "resolved" field of the lock file
    try {
      const lockPath = join(NODE_MODULES_DIR, "..", ".package-lock.json");
      const lock = JSON.parse(await readFile(lockPath, "utf-8"));
      const ahpEntry = lock.packages?.[`node_modules/agent-host-protocol`];
      ahpCommit = ahpEntry?.commit || ahpEntry?.resolved?.split("#")[1];
    } catch {
      // Will fall through to a placeholder below
    }
  }

  const sourceMd = `# Vendored: Agent Host Protocol types

This directory is the \`types/\` tree from Microsoft's Agent Host
Protocol repository, used by \`@grackle-ai/ahp\` - a publishable npm package
that builds from upstream via a prebuild transform step. It is third-party
code - **do not edit it directly**; update the pinned commit or transforms
in \`scripts/prebuild.mjs\` if upstream changes are needed.

- **Source:** ${ahpRepoUrl}
- **Path:** \`types/\`
- **Pinned commit:** \`${ahpCommit || "see package.json git dependency"}\`
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

  console.log(`Done. Vendored AHP types written to ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error("Prebuild failed:", err);
  process.exit(1);
});
