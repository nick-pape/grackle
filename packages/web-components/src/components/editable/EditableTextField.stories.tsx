import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { EditableTextField } from "./EditableTextField.js";

const meta: Meta<typeof EditableTextField> = {
  title: "Primitives/Editable/EditableTextField",
  tags: ["autodocs"],
  component: EditableTextField,
  args: {
    value: "Hello World",
    onSave: fn(),
    "data-testid": "test-field",
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Display mode shows the value with an edit button. */
export const DisplayMode: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Hello World")).toBeInTheDocument();
    const button = canvas.getByTestId("test-field-button");
    await expect(button).toBeInTheDocument();
    await expect(button).toHaveAttribute("role", "button");
  },
};

/** Display button is keyboard-accessible (tabIndex, role, focusable). */
export const KeyboardAccessible: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByTestId("test-field-button");
    await expect(button).toHaveAttribute("role", "button");
    await expect(button).toHaveAttribute("tabindex", "0");

    button.focus();
    await expect(button).toHaveFocus();
  },
};

/** Empty value shows placeholder text. */
export const EmptyShowsPlaceholder: Story = {
  args: {
    value: "",
    placeholder: "Enter a value",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Enter a value")).toBeInTheDocument();
  },
};

/** Create mode renders as an always-visible input. */
export const CreateMode: Story = {
  args: {
    mode: "create",
    value: "",
    placeholder: "Enter title",
  },
  play: async ({ canvas }) => {
    const input = canvas.getByTestId("test-field-input");
    await expect(input).toBeInTheDocument();
  },
};
