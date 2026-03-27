import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { withMockGrackle } from "@grackle-ai/web-components/src/test-utils/storybook-helpers.js";
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
    // Active Sessions section (use data-testid to avoid duplicate text matches)
    await expect(canvas.getByTestId("dashboard-active-sessions")).toBeInTheDocument();
    // Environment Health section
    await expect(canvas.getByTestId("dashboard-env-health")).toBeInTheDocument();
    // Workspaces section
    await expect(canvas.getByTestId("dashboard-workspace-snapshot")).toBeInTheDocument();
  },
};
