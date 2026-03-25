import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { EditableTextArea } from "./EditableTextArea.js";

const meta: Meta<typeof EditableTextArea> = {
  title: "Editable/EditableTextArea",
  component: EditableTextArea,
  args: {
    value: "Multi-line\ntext content",
    onSave: fn(),
    "data-testid": "test-area",
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Display mode shows the value with an edit button. */
export const DisplayMode: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByTestId("test-area-button");
    await expect(button).toBeInTheDocument();
    await expect(button).toHaveAttribute("role", "button");
  },
};

/** Display button is keyboard-accessible (tabIndex, role, focusable). */
export const KeyboardAccessible: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByTestId("test-area-button");
    await expect(button).toHaveAttribute("role", "button");
    await expect(button).toHaveAttribute("tabindex", "0");

    button.focus();
    await expect(button).toHaveFocus();
  },
};

/** Create mode renders as an always-visible textarea. */
export const CreateMode: Story = {
  args: {
    mode: "create",
    value: "",
    placeholder: "Enter description",
  },
  play: async ({ canvas }) => {
    const textarea = canvas.getByTestId("test-area-input");
    await expect(textarea).toBeInTheDocument();
  },
};
