import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { AppearancePanel } from "./AppearancePanel.js";

const meta: Meta<typeof AppearancePanel> = {
  component: AppearancePanel,
  title: "App/Panels/AppearancePanel",
  args: {
    themeId: "grackle",
    resolvedThemeId: "grackle-dark",
    onSetTheme: fn(),
    preferSystem: false,
    onSetPreferSystem: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default appearance panel with theme options and system toggle. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Appearance")).toBeInTheDocument();
    await expect(canvas.getByText("Choose how Grackle looks across the app.")).toBeInTheDocument();
    // The active theme should be reported at the bottom
    await expect(canvas.getByText("grackle-dark")).toBeInTheDocument();
    // System preference checkbox should be unchecked
    const checkbox = canvas.getByRole("checkbox");
    await expect(checkbox).not.toBeChecked();
    // Theme buttons should be present
    await expect(canvas.getByText("Grackle")).toBeInTheDocument();
    await expect(canvas.getByText("Matrix")).toBeInTheDocument();
  },
};

/** Panel with system preference enabled. */
export const SystemPreferenceEnabled: Story = {
  args: {
    preferSystem: true,
  },
  play: async ({ canvas }) => {
    const checkbox = canvas.getByRole("checkbox");
    await expect(checkbox).toBeChecked();
    await expect(canvas.getByText("Match system light/dark preference")).toBeInTheDocument();
  },
};
