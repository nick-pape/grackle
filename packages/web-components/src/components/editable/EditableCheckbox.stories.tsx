import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { EditableCheckbox } from "./EditableCheckbox.js";

const meta: Meta<typeof EditableCheckbox> = {
  component: EditableCheckbox,
  title: "Primitives/Editable/EditableCheckbox",
  tags: ["autodocs"],
  args: {
    onChange: fn(),
    label: "Enable feature",
    "data-testid": "test-checkbox",
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Unchecked checkbox in its default state. */
export const Unchecked: Story = {
  args: {
    checked: false,
  },
  play: async ({ canvas }) => {
    const label = canvas.getByTestId("test-checkbox");
    await expect(label).toBeInTheDocument();
    const checkbox = canvas.getByRole("checkbox");
    await expect(checkbox).not.toBeChecked();
    await expect(canvas.getByText("Enable feature")).toBeInTheDocument();
  },
};

/** Checked checkbox. */
export const Checked: Story = {
  args: {
    checked: true,
  },
  play: async ({ canvas }) => {
    const checkbox = canvas.getByRole("checkbox");
    await expect(checkbox).toBeChecked();
  },
};

/** Clicking the checkbox triggers onChange with the new value. */
export const ToggleOn: Story = {
  args: {
    checked: false,
  },
  play: async ({ canvas, args }) => {
    const checkbox = canvas.getByRole("checkbox");
    await expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    await expect(args.onChange).toHaveBeenCalledWith(true);
  },
};
