import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { withMockGrackleRoute } from "@grackle-ai/web-components/src/test-utils/storybook-helpers.js";
import { WorkspacePage } from "./WorkspacePage.js";

const meta: Meta<typeof WorkspacePage> = {
  component: WorkspacePage,
  parameters: { skipRouter: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Workspace page renders with workspace name and tasks tab visible. */
export const WorkspaceWithTasks: Story = {
  decorators: [withMockGrackleRoute(
    ["/environments/env-local-01/workspaces/proj-alpha"],
    "/environments/:environmentId/workspaces/:workspaceId",
  )],
  play: async ({ canvas }) => {
    // Workspace name should be visible
    await expect(canvas.getByTestId("workspace-name")).toBeInTheDocument();
    // Tasks tab should be present
    const tasksTab = canvas.getByRole("tab", { name: "Tasks" });
    await expect(tasksTab).toBeInTheDocument();
  },
};

/** Metadata section shows Description, Repository, Environment, and Persona fields. */
export const MetadataSection: Story = {
  decorators: [withMockGrackleRoute(
    ["/environments/env-local-01/workspaces/proj-alpha"],
    "/environments/:environmentId/workspaces/:workspaceId",
  )],
  play: async ({ canvas }) => {
    // The metadata panel should be visible by default
    await expect(canvas.getByTestId("workspace-meta")).toBeInTheDocument();
    // Verify key metadata labels are present
    await expect(canvas.getByText("Description")).toBeInTheDocument();
    await expect(canvas.getByText("Repository")).toBeInTheDocument();
    await expect(canvas.getByText("Environment")).toBeInTheDocument();
    await expect(canvas.getByText("Persona")).toBeInTheDocument();
  },
};
