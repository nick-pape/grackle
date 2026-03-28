import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { ToastContainer } from "./ToastContainer.js";

/** Very long duration to prevent auto-dismiss during testing. */
const TEST_DURATION: number = 999999;

const meta: Meta<typeof ToastContainer> = {
  component: ToastContainer,
  title: "Notifications/ToastContainer",
  args: {
    onDismiss: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Empty container with no toasts. */
export const Empty: Story = {
  args: {
    toasts: [],
  },
  play: async ({ canvas }) => {
    const container = canvas.getByTestId("toast-container");
    await expect(container).toBeInTheDocument();
    // No toast items visible
    const statuses = canvas.queryAllByRole("status");
    await expect(statuses.length).toBe(0);
  },
};

/** Container with a single toast. */
export const SingleToast: Story = {
  args: {
    toasts: [
      { id: "t1", message: "File saved", variant: "success", duration: TEST_DURATION },
    ],
  },
  play: async ({ canvas }) => {
    const container = canvas.getByTestId("toast-container");
    await expect(container).toBeInTheDocument();
    const toast = canvas.getByRole("status");
    await expect(toast).toHaveTextContent("File saved");
  },
};

/** Container rendering multiple toasts simultaneously. */
export const MultipleToasts: Story = {
  args: {
    toasts: [
      { id: "t1", message: "First toast", variant: "info", duration: TEST_DURATION },
      { id: "t2", message: "Second toast", variant: "success", duration: TEST_DURATION },
      { id: "t3", message: "Third toast", variant: "error", duration: TEST_DURATION },
    ],
  },
  play: async ({ canvas }) => {
    const container = canvas.getByTestId("toast-container");
    await expect(container).toBeInTheDocument();
    const statuses = canvas.getAllByRole("status");
    await expect(statuses.length).toBe(3);
    await expect(canvas.getByText("First toast")).toBeInTheDocument();
    await expect(canvas.getByText("Second toast")).toBeInTheDocument();
    await expect(canvas.getByText("Third toast")).toBeInTheDocument();
  },
};
