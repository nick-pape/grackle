import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { Button } from "./Button.js";

const meta: Meta<typeof Button> = {
  component: Button,
  title: "Primitives/Display/Button",
  tags: ["autodocs"],
  args: {
    children: "Click me",
    onClick: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default primary button at medium size. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByRole("button", { name: "Click me" });
    await expect(button).toBeInTheDocument();
    await expect(button).toBeEnabled();
  },
};

/** Danger variant for destructive actions. */
export const Danger: Story = {
  args: {
    variant: "danger",
    children: "Delete",
  },
  play: async ({ canvas }) => {
    const button = canvas.getByRole("button", { name: "Delete" });
    await expect(button).toBeInTheDocument();
    await expect(button.className).toContain("danger");
  },
};

/** Ghost variant for minimal visual weight. */
export const Ghost: Story = {
  args: {
    variant: "ghost",
    children: "Cancel",
  },
  play: async ({ canvas }) => {
    const button = canvas.getByRole("button", { name: "Cancel" });
    await expect(button).toBeInTheDocument();
    await expect(button.className).toContain("ghost");
  },
};

/** Small size variant. */
export const Small: Story = {
  args: {
    size: "sm",
    children: "Small",
  },
  play: async ({ canvas }) => {
    const button = canvas.getByRole("button", { name: "Small" });
    await expect(button).toBeInTheDocument();
    await expect(button.className).toContain("sm");
  },
};

/** Large size variant. */
export const Large: Story = {
  args: {
    size: "lg",
    children: "Large",
  },
  play: async ({ canvas }) => {
    const button = canvas.getByRole("button", { name: "Large" });
    await expect(button).toBeInTheDocument();
    await expect(button.className).toContain("lg");
  },
};

/** Disabled button prevents interaction. */
export const Disabled: Story = {
  args: {
    disabled: true,
    children: "Disabled",
  },
  play: async ({ canvas }) => {
    const button = canvas.getByRole("button", { name: "Disabled" });
    await expect(button).toBeDisabled();
  },
};
