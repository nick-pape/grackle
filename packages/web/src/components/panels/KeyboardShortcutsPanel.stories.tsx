import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { KeyboardShortcutsPanel } from "./KeyboardShortcutsPanel.js";

const meta: Meta<typeof KeyboardShortcutsPanel> = {
  title: "Panels/KeyboardShortcutsPanel",
  component: KeyboardShortcutsPanel,
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Panel renders with all shortcut categories visible. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("keyboard-shortcuts-panel")).toBeInTheDocument();
    await expect(canvas.getByText("Keyboard Shortcuts")).toBeInTheDocument();
  },
};

/** All category headings are rendered. */
export const AllCategoriesRendered: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Global")).toBeInTheDocument();
    await expect(canvas.getByText("Task Page")).toBeInTheDocument();
    await expect(canvas.getByText("Workspace Page")).toBeInTheDocument();
    await expect(canvas.getByText("Navigation Lists")).toBeInTheDocument();
    await expect(canvas.getByText("Editing")).toBeInTheDocument();
    await expect(canvas.getByText("Chat")).toBeInTheDocument();
  },
};

/** Specific shortcut descriptions are present. */
export const ShortcutDescriptions: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Open keyboard shortcuts reference")).toBeInTheDocument();
    await expect(canvas.getByText("Create a new task")).toBeInTheDocument();
    await expect(canvas.getByText("Switch to Overview tab")).toBeInTheDocument();
    await expect(canvas.getByText("Send message (when input is focused)")).toBeInTheDocument();
  },
};
