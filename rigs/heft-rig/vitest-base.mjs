// Shared Vitest config base for every Grackle package. Centralizes:
//   - Test discovery globs (`src/**/*.test.ts(x)`)
//   - The `node` environment + standard timeout/isolation settings
//   - Coverage collection via the v8 provider
//
// Per-package configs import `createVitestConfig` and pass overrides:
//
//   import { createVitestConfig } from "@grackle-ai/heft-rig/vitest-base.mjs";
//   export default createVitestConfig({
//     test: { environment: "jsdom" },  // example override
//   });
//
// Coverage thresholds are intentionally NOT set here — see issue #1326 (Phase 3
// of the coverage rollout) for the follow-up that enables enforcement once we
// have real baseline numbers.

import { defineConfig, mergeConfig } from "vitest/config";

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
      // `--coverage` flag (passed by @grackle-ai/heft-web-test-plugin's
      // VitestPlugin during `rush test`). Local `vitest`/`vitest watch`
      // runs stay fast for TDD.
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
