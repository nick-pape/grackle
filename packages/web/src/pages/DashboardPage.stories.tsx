import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { withMockGrackle } from "../test-utils/storybook-helpers.js";
import { DashboardPage } from "./DashboardPage.js";

const meta: Meta<typeof DashboardPage> = {
  component: DashboardPage,
  decorators: [withMockGrackle],
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Dashboard sections render correctly with mock data. */
export const SectionsRender: Story = {
  play: async ({ canvas }) => {
    // Active Sessions section
    await expect(canvas.getByText("Active Sessions")).toBeInTheDocument();
    // Environment Health section
    await expect(canvas.getByText("Environment Health")).toBeInTheDocument();
    // Workspaces section
    await expect(canvas.getByText("Workspaces")).toBeInTheDocument();
  },
};
