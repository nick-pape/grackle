import type { JSX } from "react";
import { MemoryRouter, Routes, Route } from "react-router";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor } from "@storybook/test";
import { withMockGrackle } from "@grackle-ai/web-components";
import { EnvironmentDetailPage } from "./EnvironmentDetailPage.js";

/** Wrapper that renders EnvironmentDetailPage at the given environment route. */
function DetailRouteWrapper({ envId }: { envId: string }): JSX.Element {
  return (
    <MemoryRouter initialEntries={[`/environments/${envId}`]}>
      <Routes>
        <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const meta: Meta = {
  component: EnvironmentDetailPage,
  decorators: [withMockGrackle],
  parameters: { skipRouter: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** New Chat button is visible and enabled for a connected environment. */
export const NewChatButtonVisible: Story = {
  render: () => <DetailRouteWrapper envId="env-local-01" />,
  play: async ({ canvas }) => {
    const newChatButton = canvas.getByRole("button", { name: "New Chat" });
    await expect(newChatButton).toBeInTheDocument();
    await expect(newChatButton).toBeVisible();
    await expect(newChatButton).toBeEnabled();
  },
};

/** Workspaces section shows workspaces that include this env in their pool. */
export const LinkedWorkspacesVisible: Story = {
  // env-docker-01 is linked to proj-alpha (which has primary env-local-01)
  render: () => <DetailRouteWrapper envId="env-docker-01" />,
  play: async ({ canvas }) => {
    // The "Workspaces" heading should be present
    await expect(canvas.getByText("Workspaces")).toBeInTheDocument();
    // At least one linked workspace card (e.g., proj-alpha / Workspace Alpha) should appear
    const linkedWorkspaceCards = canvas.getAllByTestId(/^linked-workspace-card-/);
    await expect(linkedWorkspaceCards.length).toBeGreaterThan(0);
  },
};

/** Workspaces section shows empty state when no workspaces are linked. */
export const LinkedWorkspacesEmpty: Story = {
  // env-cs-01 has no workspaces linked to it in mock data
  render: () => <DetailRouteWrapper envId="env-cs-01" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Workspaces")).toBeInTheDocument();
    await expect(canvas.getByTestId("linked-workspaces-empty")).toBeInTheDocument();
  },
};

/** Linked workspace cards have an Unlink button. */
export const UnlinkButtonOnCard: Story = {
  render: () => <DetailRouteWrapper envId="env-docker-01" />,
  play: async ({ canvas }) => {
    // proj-alpha is linked to env-docker-01
    const unlinkButton = canvas.getByTestId("unlink-workspace-proj-alpha");
    await expect(unlinkButton).toBeInTheDocument();
    await expect(unlinkButton).toHaveTextContent("Unlink");
  },
};

/** Linking a workspace to error-env shows an error message. */
export const LinkErrorShowsMessage: Story = {
  render: () => <DetailRouteWrapper envId="error-env" />,
  play: async ({ canvas }) => {
    // Select a workspace from the link dropdown to trigger a mock error
    const linkSelect = canvas.getByTestId("link-workspace-select");
    await userEvent.selectOptions(linkSelect, "proj-alpha");
    // Error message should appear
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      expect(canvas.getByTestId("link-operation-error")).toBeInTheDocument();
    });
    await expect(canvas.getByTestId("link-operation-error")).toHaveTextContent("Failed to link environment");
  },
};

/** Clicking the error message dismisses it. */
export const LinkErrorDismissible: Story = {
  render: () => <DetailRouteWrapper envId="error-env" />,
  play: async ({ canvas }) => {
    // Trigger the error first
    const linkSelect = canvas.getByTestId("link-workspace-select");
    await userEvent.selectOptions(linkSelect, "proj-alpha");
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      expect(canvas.getByTestId("link-operation-error")).toBeInTheDocument();
    });
    // Click the dismiss button
    await userEvent.click(canvas.getByTestId("dismiss-link-error"));
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      expect(canvas.queryByTestId("link-operation-error")).not.toBeInTheDocument();
    });
  },
};

/** Clicking Unlink removes the linked workspace card. */
export const UnlinkRemovesCard: Story = {
  render: () => <DetailRouteWrapper envId="env-docker-01" />,
  play: async ({ canvas }) => {
    // proj-alpha is linked to env-docker-01
    await expect(canvas.getByTestId("unlink-workspace-proj-alpha")).toBeInTheDocument();
    // Click Unlink
    await userEvent.click(canvas.getByTestId("unlink-workspace-proj-alpha"));
    // proj-alpha card should disappear (proj-beta remains, so no empty state)
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      expect(canvas.queryByTestId("linked-workspace-card-proj-alpha")).not.toBeInTheDocument();
    });
    await expect(canvas.getByTestId("linked-workspace-card-proj-beta")).toBeInTheDocument();
  },
};
