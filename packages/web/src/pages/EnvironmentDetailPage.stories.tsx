import type { JSX } from "react";
import { MemoryRouter, Routes, Route } from "react-router";
import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
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

/** Linked Workspaces section shows workspaces that include this env in their pool. */
export const LinkedWorkspacesVisible: Story = {
  // env-docker-01 is linked to proj-alpha (which has primary env-local-01)
  render: () => <DetailRouteWrapper envId="env-docker-01" />,
  play: async ({ canvas }) => {
    // The "Linked Workspaces" heading should be present
    await expect(canvas.getByText("Linked Workspaces")).toBeInTheDocument();
    // proj-alpha (Workspace Alpha) should appear as a linked workspace card
    await expect(canvas.getByTestId("linked-workspace-card")).toBeInTheDocument();
  },
};

/** Linked Workspaces section shows empty state when no workspaces are linked. */
export const LinkedWorkspacesEmpty: Story = {
  // env-local-01 has primary workspaces but no linked ones in mock data
  render: () => <DetailRouteWrapper envId="env-local-01" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Linked Workspaces")).toBeInTheDocument();
    await expect(canvas.getByTestId("linked-workspaces-empty")).toBeInTheDocument();
  },
};
