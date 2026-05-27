// Shared Vitest config base for every Grackle package. Centralizes:
//   - Test discovery globs (`src/**/*.test.ts(x)`)
//   - The `node` environment + standard timeout/isolation settings
//   - Coverage collection via the v8 provider
//   - Per-package coverage thresholds (PR gate, #1326)
//
// Per-package configs import `createVitestConfig` and pass overrides:
//
//   import { createVitestConfig } from "@grackle-ai/heft-rig/vitest-base.mjs";
//   export default createVitestConfig({
//     test: { environment: "jsdom" },  // example override
//   });

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { defineConfig, mergeConfig } from "vitest/config";

// Per-package coverage floors (#1326). Values are the rounded-down 5%
// boundary of each package's baseline coverage from the measurement-only
// PR (#1328). Frozen — no auto-ratchet. Bump by hand when a package's
// real coverage climbs and you want to lock the new floor in.
const THRESHOLDS_PATH = new URL("./coverage-thresholds.json", import.meta.url);
const COVERAGE_THRESHOLDS = JSON.parse(readFileSync(THRESHOLDS_PATH, "utf8"));

/** Looks up the thresholds entry for the package whose vitest.config.ts is loading us. */
function thresholdsForCurrentPackage() {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  const entry = COVERAGE_THRESHOLDS[pkg.name];
  if (!entry) {
    process.stderr.write(
      `[vitest-base] No coverage thresholds defined for ${pkg.name}; ` +
        `running unenforced. Add an entry to ` +
        `rigs/heft-rig/coverage-thresholds.json after this package has a baseline.\n`,
    );
    return undefined;
  }
  return entry;
}

const baseConfig = defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    testTimeout: 10_000,
    isolate: true,
    // Note: `passWithNoTests` is intentionally NOT set here. If a package's
    // test glob silently breaks (e.g. after a refactor) we want vitest to
    // fail loudly. Per-package configs can opt-in via overrides if they
    // genuinely have no tests yet.
    coverage: {
      // `enabled` is intentionally NOT set — coverage is opt-in via the CLI
      // `--coverage` flag, which is passed by the heft Vitest task plugin
      // in `rigs/heft-storybook-plugin/src/VitestPlugin.ts` (package name
      // `@grackle-ai/heft-web-test-plugin`) during `rush test`. Local
      // `vitest` / `vitest watch` runs stay fast for TDD.
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.stories.{ts,tsx}",
        "src/**/__mocks__/**",
        "src/**/mocks/**",
        "src/gen/**",
        "src/vendor/**",
        "src/**/*.d.ts",
      ],
      clean: true,
      thresholds: thresholdsForCurrentPackage(),
    },
  },
});

/**
 * @param {import("vitest/config").UserConfigExport} [overrides]
 *   Package-specific overrides (e.g. a different `environment`). Merged on top
 *   of the base via Vitest's `mergeConfig` (array fields concat, scalars win).
 * @returns {import("vitest/config").UserConfig}
 */
export function createVitestConfig(overrides) {
  if (!overrides) {
    return baseConfig;
  }
  return mergeConfig(baseConfig, defineConfig(overrides));
}
