import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
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
