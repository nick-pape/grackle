import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: "@storybook/react-vite",
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-controls",
  ],
  docs: {
    autodocs: "tag",
  },
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (viteConfig) => {
    viteConfig.base = process.env.STORYBOOK_BASE || "/";
    return viteConfig;
  },
};

export default config;
