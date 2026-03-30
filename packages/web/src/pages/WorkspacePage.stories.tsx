import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor } from "@storybook/test";
import { withMockGrackleRoute } from "@grackle-ai/web-components";
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

/** Metadata section shows Description, Repository, Environment, Linked Envs, and Persona fields. */
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
    await expect(canvas.getByText("Linked Envs")).toBeInTheDocument();
    await expect(canvas.getByText("Persona")).toBeInTheDocument();
  },
};

/** Linked environments section shows chips for each linked environment. */
export const LinkedEnvironments: Story = {
  decorators: [withMockGrackleRoute(
    ["/environments/env-local-01/workspaces/proj-alpha"],
    "/environments/:environmentId/workspaces/:workspaceId",
  )],
  play: async ({ canvas }) => {
    // proj-alpha has linkedEnvironmentIds: ["env-docker-01"] in mock data
    const linkedSection = canvas.getByTestId("linked-environments");
    await expect(linkedSection).toBeInTheDocument();
    // Should show the linked environment chip (Docker Dev is env-docker-01's displayName)
    await expect(canvas.getByTestId("linked-env-env-docker-01")).toBeInTheDocument();
  },
};

/** Workspace with no linked environments shows "None" and a link dropdown. */
export const NoLinkedEnvironments: Story = {
  decorators: [withMockGrackleRoute(
    ["/environments/env-docker-01/workspaces/proj-beta"],
    "/environments/:environmentId/workspaces/:workspaceId",
  )],
  play: async ({ canvas }) => {
    // proj-beta has linkedEnvironmentIds: [] in mock data
    const linkedSection = canvas.getByTestId("linked-environments");
    await expect(linkedSection).toBeInTheDocument();
    await expect(linkedSection).toHaveTextContent("None");
  },
};

/** Linked environment chip has a dismiss (unlink) button. */
export const UnlinkButtonOnChip: Story = {
  decorators: [withMockGrackleRoute(
    ["/environments/env-local-01/workspaces/proj-alpha"],
    "/environments/:environmentId/workspaces/:workspaceId",
  )],
  play: async ({ canvas }) => {
    // proj-alpha has env-docker-01 linked
    const unlinkButton = canvas.getByTestId("unlink-env-env-docker-01");
    await expect(unlinkButton).toBeInTheDocument();
  },
};

/** Link environment dropdown shows available environments. */
export const LinkEnvironmentDropdown: Story = {
  decorators: [withMockGrackleRoute(
    ["/environments/env-docker-01/workspaces/proj-beta"],
    "/environments/:environmentId/workspaces/:workspaceId",
  )],
  play: async ({ canvas }) => {
    // proj-beta has no linked envs and primary is env-docker-01
    // Should show a link dropdown with available environments
    const linkSelect = canvas.getByTestId("link-env-select");
    await expect(linkSelect).toBeInTheDocument();
  },
};

/** Clicking unlink removes the linked environment chip. */
export const UnlinkRemovesChip: Story = {
  decorators: [withMockGrackleRoute(
    ["/environments/env-local-01/workspaces/proj-alpha"],
    "/environments/:environmentId/workspaces/:workspaceId",
  )],
  play: async ({ canvas }) => {
    // proj-alpha starts with env-docker-01 linked
    await expect(canvas.getByTestId("linked-env-env-docker-01")).toBeInTheDocument();
    // Click unlink
    await userEvent.click(canvas.getByTestId("unlink-env-env-docker-01"));
    // Chip should disappear (MockGrackleProvider removes it from state)
    await waitFor(() => {
      void expect(canvas.queryByTestId("linked-env-env-docker-01")).not.toBeInTheDocument();
    });
    // "None" placeholder should appear
    const linkedSection = canvas.getByTestId("linked-environments");
    await expect(linkedSection).toHaveTextContent("None");
  },
};

/** Selecting from the link dropdown adds a linked environment chip. */
export const LinkAddsChip: Story = {
  decorators: [withMockGrackleRoute(
    ["/environments/env-docker-01/workspaces/proj-beta"],
    "/environments/:environmentId/workspaces/:workspaceId",
  )],
  play: async ({ canvas }) => {
    // proj-beta starts with no linked envs, "None" shown
    const linkedSection = canvas.getByTestId("linked-environments");
    await expect(linkedSection).toHaveTextContent("None");
    // Select "Local" from the link dropdown (env-local-01)
    const linkSelect = canvas.getByTestId("link-env-select");
    await userEvent.selectOptions(linkSelect, "env-local-01");
    // A chip for env-local-01 should appear
    await waitFor(async () => {
      await expect(canvas.getByTestId("linked-env-env-local-01")).toBeInTheDocument();
    });
  },
};
