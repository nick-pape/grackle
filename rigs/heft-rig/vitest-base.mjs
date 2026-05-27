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
    passWithNoTests: true,
    coverage: {
      enabled: true,
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
