import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { ConfirmDialog } from "./ConfirmDialog.js";

const meta: Meta<typeof ConfirmDialog> = {
  title: "Primitives/Display/ConfirmDialog",
  tags: ["autodocs"],
  component: ConfirmDialog,
  args: {
    isOpen: true,
    title: "Delete Task?",
    description: '"tdel-dismiss-task" will be permanently removed.',
    confirmLabel: "Delete",
    onConfirm: fn(),
    onCancel: fn(),
  },
};

export default meta;

type Story = StoryObj<typeof ConfirmDialog>;

/** The confirm dialog can be dismissed by clicking Cancel, which calls onCancel. */
export const DismissViaCancelButton: Story = {
  play: async ({ canvas, args }) => {
    // Dialog is visible with the correct title
    await expect(canvas.getByText("Delete Task?")).toBeInTheDocument();

    // Description text is shown
    await expect(canvas.getByText(/tdel-dismiss-task/)).toBeInTheDocument();

    // Cancel button is present and clickable
    const cancelButton = canvas.getByRole("button", { name: "Cancel" });
    await expect(cancelButton).toBeInTheDocument();
    await userEvent.click(cancelButton);

    // onCancel should have been called
    await expect(args.onCancel).toHaveBeenCalled();

    // onConfirm should NOT have been called
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

/** The confirm dialog calls onConfirm when the Delete button is clicked. */
export const ConfirmAction: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText("Delete Task?")).toBeInTheDocument();

    const confirmButton = canvas.getByRole("button", { name: "Delete" });
    await userEvent.click(confirmButton);

    await expect(args.onConfirm).toHaveBeenCalled();
    await expect(args.onCancel).not.toHaveBeenCalled();
  },
};

/** Pressing Escape calls onCancel to dismiss the dialog. */
export const EscapeKeyCloses: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText("Delete Task?")).toBeInTheDocument();

    // Press Escape to dismiss
    await userEvent.keyboard("{Escape}");

    await expect(args.onCancel).toHaveBeenCalled();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

/** When isOpen is false the dialog renders nothing visible. */
export const ClosedDialog: Story = {
  args: {
    isOpen: false,
  },
  play: async ({ canvas }) => {
    // The title text should not be in the document when the dialog is closed
    const title = canvas.queryByText("Delete Task?");
    await expect(title).not.toBeInTheDocument();
  },
};
