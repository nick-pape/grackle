import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Whether to istanbul-instrument the component source for Storybook coverage
 * (#1384). Gated by env so normal `storybook dev`/`build` stay fast; CI sets
 * `STORYBOOK_COVERAGE=true` for the whole build so the cached `storybook-static`
 * is consistently instrumented. The instrumented bundle is internal-only (never
 * shipped — npm ships `dist`, not `storybook-static`).
 */
const STORYBOOK_COVERAGE: boolean = process.env.STORYBOOK_COVERAGE === "true";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: "@storybook/react-vite",
  addons: ["@storybook/addon-docs", "@storybook/addon-controls"],
  docs: {
    autodocs: "tag",
  },
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (viteConfig) => {
    viteConfig.base = process.env.STORYBOOK_BASE || "/";
    if (STORYBOOK_COVERAGE) {
      // Instrument component source so `test-storybook --coverage` can harvest
      // `window.__coverage__`. `exclude` mirrors rigs/heft-rig/vitest-base.mjs
      // so the Storybook numbers reconcile with unit coverage in the merge.
      // Dynamic import: vite-plugin-istanbul is ESM-only (no `require` export),
      // and Storybook evaluates this file in a CJS context — a static import
      // would fail to load. Importing only here also keeps non-coverage builds
      // from touching the plugin at all.
      const { default: istanbul } = await import("vite-plugin-istanbul");
      viteConfig.plugins = viteConfig.plugins ?? [];
      viteConfig.plugins.push(
        istanbul({
          include: ["src/**/*"],
          exclude: [
            "**/*.test.{ts,tsx}",
            "**/*.stories.{ts,tsx}",
            "**/__mocks__/**",
            "**/mocks/**",
            "**/gen/**",
            "**/vendor/**",
          ],
          extension: [".ts", ".tsx"],
          requireEnv: false,
          forceBuildInstrument: true,
        }),
      );
    }
    return viteConfig;
  },
};

export default config;
