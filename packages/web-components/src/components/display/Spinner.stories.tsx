import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { Spinner } from "./Spinner.js";

const meta: Meta<typeof Spinner> = {
  component: Spinner,
  title: "Display/Spinner",
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default medium spinner. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const spinner = canvas.getByLabelText("Loading");
    await expect(spinner).toBeInTheDocument();
    await expect(spinner.className).toContain("md");
  },
};

/** Small spinner. */
export const Small: Story = {
  args: { size: "sm" },
  play: async ({ canvas }) => {
    const spinner = canvas.getByLabelText("Loading");
    await expect(spinner.className).toContain("sm");
  },
};

/** Large spinner. */
export const Large: Story = {
  args: { size: "lg" },
  play: async ({ canvas }) => {
    const spinner = canvas.getByLabelText("Loading");
    await expect(spinner.className).toContain("lg");
  },
};

/** Extra large spinner. */
export const ExtraLarge: Story = {
  args: { size: "xl" },
  play: async ({ canvas }) => {
    const spinner = canvas.getByLabelText("Loading");
    await expect(spinner.className).toContain("xl");
  },
};

/** Spinner with a custom accessible label. */
export const WithLabel: Story = {
  args: { label: "Saving changes" },
  play: async ({ canvas }) => {
    const spinner = canvas.getByLabelText("Saving changes");
    await expect(spinner).toBeInTheDocument();
  },
};

/** Spinner as a live region announces changes to screen readers. */
export const LiveRegion: Story = {
  args: { liveRegion: true, label: "Processing" },
  play: async ({ canvas }) => {
    const spinner = canvas.getByRole("status");
    await expect(spinner).toBeInTheDocument();
    await expect(spinner).toHaveAttribute("aria-label", "Processing");
  },
};
