import type { StorybookConfig } from "@storybook/react-vite";

/** Istanbul-instrument component source for Storybook coverage when set (#1384). */
const STORYBOOK_COVERAGE: boolean = process.env.STORYBOOK_COVERAGE === "true";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: "@storybook/react-vite",
  addons: [],
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (viteConfig) => {
    if (STORYBOOK_COVERAGE) {
      // Dynamic import: vite-plugin-istanbul is ESM-only and Storybook evaluates
      // this file in a CJS context (see web-components/.storybook/main.ts).
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
