import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { DemoBanner } from "./DemoBanner.js";

const meta: Meta<typeof DemoBanner> = {
  title: "Display/DemoBanner",
  component: DemoBanner,
};

export default meta;

type Story = StoryObj<typeof DemoBanner>;

/** Banner renders with the DEMO label and install link. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const banner = canvas.getByTestId("demo-banner");
    await expect(banner).toBeInTheDocument();

    // DEMO label is visible
    await expect(canvas.getByText("DEMO")).toBeInTheDocument();

    // Descriptive text is present
    await expect(canvas.getByText(/interactive demo with mock data/)).toBeInTheDocument();

    // Install link points to the GitHub repo
    const link = canvas.getByRole("link", { name: "Install Grackle" });
    await expect(link).toBeInTheDocument();
    await expect(link).toHaveAttribute("href", "https://github.com/nick-pape/grackle");
  },
};

/** Install link opens in a new tab with security attributes. */
export const LinkOpensInNewTab: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole("link", { name: "Install Grackle" });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  },
};
