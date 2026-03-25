import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { EditableTextField } from "./EditableTextField.js";

const meta: Meta<typeof EditableTextField> = {
  title: "Editable/EditableTextField",
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

/** Display button is keyboard-accessible (tabIndex, role). */
export const KeyboardAccessible: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByTestId("test-field-button");
    await expect(button).toHaveAttribute("role", "button");
    await expect(button).toHaveAttribute("tabindex", "0");

    // Focus is accepted
    button.focus();
    await expect(button).toHaveFocus();
  },
};

/** Pressing Enter in edit mode saves the value. */
export const EnterToSave: Story = {
  play: async ({ canvas, args }) => {
    // Click to enter edit mode
    const button = canvas.getByTestId("test-field-button");
    await userEvent.click(button);

    const input = canvas.getByTestId("test-field-input");
    await userEvent.clear(input);
    await userEvent.type(input, "Updated Value");
    await userEvent.keyboard("{Enter}");

    await expect(args.onSave).toHaveBeenCalledWith("Updated Value");
  },
};

/** Pressing Escape in edit mode cancels without saving. */
export const EscapeToCancel: Story = {
  play: async ({ canvas, args }) => {
    // Click to enter edit mode
    const button = canvas.getByTestId("test-field-button");
    await userEvent.click(button);

    const input = canvas.getByTestId("test-field-input");
    await userEvent.clear(input);
    await userEvent.type(input, "Changed text");
    await userEvent.keyboard("{Escape}");

    // onSave should not have been called
    await expect(args.onSave).not.toHaveBeenCalled();

    // Should return to display mode with original value
    await expect(canvas.getByText("Hello World")).toBeInTheDocument();
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
