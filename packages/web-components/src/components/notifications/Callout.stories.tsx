import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { Callout } from "./Callout.js";

const meta: Meta<typeof Callout> = {
  component: Callout,
  title: "Primitives/Notifications/Callout",
  tags: ["autodocs"],
  args: {
    children: "This is a callout message.",
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default info callout. */
export const Info: Story = {
  play: async ({ canvas }) => {
    const callout = canvas.getByRole("status");
    await expect(callout).toBeInTheDocument();
    await expect(callout).toHaveTextContent("This is a callout message.");
  },
};

/** Error callout uses alert role for screen readers. */
export const Error: Story = {
  args: {
    variant: "error",
    children: "Something went wrong.",
  },
  play: async ({ canvas }) => {
    const callout = canvas.getByRole("alert");
    await expect(callout).toBeInTheDocument();
    await expect(callout).toHaveTextContent("Something went wrong.");
    await expect(callout.className).toContain("error");
  },
};

/** Warning callout uses alert role for screen readers. */
export const Warning: Story = {
  args: {
    variant: "warning",
    children: "Check your settings.",
  },
  play: async ({ canvas }) => {
    const callout = canvas.getByRole("alert");
    await expect(callout).toBeInTheDocument();
    await expect(callout).toHaveTextContent("Check your settings.");
    await expect(callout.className).toContain("warning");
  },
};

/** Success callout. */
export const Success: Story = {
  args: {
    variant: "success",
    children: "Operation completed.",
  },
  play: async ({ canvas }) => {
    const callout = canvas.getByRole("status");
    await expect(callout).toBeInTheDocument();
    await expect(callout).toHaveTextContent("Operation completed.");
    await expect(callout.className).toContain("success");
  },
};

/** Dismissible callout can be closed by clicking the dismiss button. */
export const Dismissible: Story = {
  args: {
    dismissible: true,
    children: "You can dismiss this.",
  },
  play: async ({ canvas }) => {
    const callout = canvas.getByRole("status");
    await expect(callout).toBeInTheDocument();
    const dismiss = canvas.getByLabelText("Dismiss");
    await expect(dismiss).toBeInTheDocument();
    await userEvent.click(dismiss);
    await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
  },
};
