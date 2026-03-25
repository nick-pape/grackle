import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
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

/** Clicking activates edit mode and shows the textarea. */
export const EditMode: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByTestId("test-area-button");
    await userEvent.click(button);

    const textarea = canvas.getByTestId("test-area-input");
    await expect(textarea).toBeInTheDocument();
  },
};

/** Pressing Escape in edit mode cancels without saving. */
export const EscapeToCancel: Story = {
  play: async ({ canvas, args }) => {
    const button = canvas.getByTestId("test-area-button");
    await userEvent.click(button);

    const textarea = canvas.getByTestId("test-area-input");
    await userEvent.type(textarea, " extra text");
    await userEvent.keyboard("{Escape}");

    // onSave should not have been called
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};
