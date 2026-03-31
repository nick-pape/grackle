import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { AnimatePresence } from "motion/react";
import { FloatingActionBar } from "./FloatingActionBar.js";

const meta: Meta<typeof FloatingActionBar> = {
  component: FloatingActionBar,
  title: "Grackle/Display/FloatingActionBar",
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ position: "relative", height: 200, background: "var(--bg-primary)" }}>
        <AnimatePresence>
          <Story />
        </AnimatePresence>
      </div>
    ),
  ],
  args: {
    selectedCount: 3,
    totalSelectable: 10,
    onSelectAll: fn(),
    onDeselectAll: fn(),
    onCopy: fn(),
    onForward: fn(),
    onCancel: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default state with some events selected. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const count = canvas.getByTestId("floating-bar-count");
    await expect(count).toHaveTextContent("3 selected");

    const selectAll = canvas.getByTestId("floating-bar-select-all");
    await expect(selectAll).toHaveTextContent("Select all");

    const copyBtn = canvas.getByTestId("floating-bar-copy");
    await expect(copyBtn).toBeEnabled();

    const cancelBtn = canvas.getByTestId("floating-bar-cancel");
    await expect(cancelBtn).toBeInTheDocument();
  },
};

/** All events selected - shows "Deselect all". */
export const AllSelected: Story = {
  args: {
    selectedCount: 10,
    totalSelectable: 10,
  },
  play: async ({ canvas }) => {
    const count = canvas.getByTestId("floating-bar-count");
    await expect(count).toHaveTextContent("10 selected");

    const toggle = canvas.getByTestId("floating-bar-select-all");
    await expect(toggle).toHaveTextContent("Deselect all");
  },
};

/** No events selected - Copy button is disabled. */
export const NoneSelected: Story = {
  args: {
    selectedCount: 0,
  },
  play: async ({ canvas }) => {
    const count = canvas.getByTestId("floating-bar-count");
    await expect(count).toHaveTextContent("0 selected");

    const copyBtn = canvas.getByTestId("floating-bar-copy");
    await expect(copyBtn).toBeDisabled();
  },
};

/** Forward button is visible and enabled when active sessions exist. */
export const WithForwardEnabled: Story = {
  args: {
    forwardDisabled: false,
  },
  play: async ({ canvas }) => {
    const forwardBtn = canvas.getByTestId("floating-bar-forward");
    await expect(forwardBtn).toBeInTheDocument();
    await expect(forwardBtn).toBeEnabled();
  },
};

/** Forward button is disabled when no active sessions are available. */
export const ForwardDisabled: Story = {
  args: {
    forwardDisabled: true,
  },
  play: async ({ canvas }) => {
    const forwardBtn = canvas.getByTestId("floating-bar-forward");
    await expect(forwardBtn).toBeDisabled();
  },
};

/** Forward button is hidden when onForward is not provided. */
export const NoForwardButton: Story = {
  args: {
    onForward: undefined,
  },
  play: async ({ canvas }) => {
    const forwardBtn = canvas.queryByTestId("floating-bar-forward");
    await expect(forwardBtn).not.toBeInTheDocument();
  },
};

/** Clicking Forward calls onForward. */
export const ForwardClick: Story = {
  args: {
    forwardDisabled: false,
  },
  play: async ({ canvas, args }) => {
    const forwardBtn = canvas.getByTestId("floating-bar-forward");
    await userEvent.click(forwardBtn);
    await expect(args.onForward).toHaveBeenCalled();
  },
};
