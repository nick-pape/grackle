import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { Toast } from "./Toast.js";

/** Very long duration to prevent auto-dismiss during testing. */
const TEST_DURATION: number = 999999;

const meta: Meta<typeof Toast> = {
  component: Toast,
  title: "Notifications/Toast",
  args: {
    onDismiss: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Info toast notification. */
export const Info: Story = {
  args: {
    toast: { id: "t-info", message: "Something happened", variant: "info", duration: TEST_DURATION },
  },
  play: async ({ canvas }) => {
    const toast = canvas.getByRole("status");
    await expect(toast).toBeInTheDocument();
    await expect(toast).toHaveTextContent("Something happened");
    // Verify dismiss button exists
    const dismiss = canvas.getByLabelText("Dismiss notification");
    await expect(dismiss).toBeInTheDocument();
  },
};

/** Success toast notification. */
export const Success: Story = {
  args: {
    toast: { id: "t-success", message: "Changes saved", variant: "success", duration: TEST_DURATION },
  },
  play: async ({ canvas }) => {
    const toast = canvas.getByRole("status");
    await expect(toast).toBeInTheDocument();
    await expect(toast).toHaveTextContent("Changes saved");
    await expect(toast.className).toContain("success");
  },
};

/** Error toast notification. */
export const Error: Story = {
  args: {
    toast: { id: "t-error", message: "Failed to save", variant: "error", duration: TEST_DURATION },
  },
  play: async ({ canvas }) => {
    const toast = canvas.getByRole("status");
    await expect(toast).toBeInTheDocument();
    await expect(toast).toHaveTextContent("Failed to save");
    await expect(toast.className).toContain("error");
  },
};

/** Warning toast notification. */
export const Warning: Story = {
  args: {
    toast: { id: "t-warn", message: "Connection unstable", variant: "warning", duration: TEST_DURATION },
  },
  play: async ({ canvas }) => {
    const toast = canvas.getByRole("status");
    await expect(toast).toBeInTheDocument();
    await expect(toast).toHaveTextContent("Connection unstable");
    await expect(toast.className).toContain("warning");
  },
};
