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

// ---------------------------------------------------------------------------
// Existing stories: lifecycle + workspaces
// ---------------------------------------------------------------------------

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
  render: () => <DetailRouteWrapper envId="env-docker-01" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Workspaces")).toBeInTheDocument();
    const linkedWorkspaceCards = canvas.getAllByTestId("workspace-card");
    await expect(linkedWorkspaceCards.length).toBeGreaterThan(0);
  },
};

/** Workspaces section shows empty state when no workspaces are linked. */
export const LinkedWorkspacesEmpty: Story = {
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
    const unlinkButton = canvas.getByTestId("unlink-workspace-proj-alpha");
    await expect(unlinkButton).toBeInTheDocument();
    await expect(unlinkButton).toHaveTextContent("Unlink");
  },
};

/** Linking a workspace to error-env shows an error message. */
export const LinkErrorShowsMessage: Story = {
  render: () => <DetailRouteWrapper envId="error-env" />,
  play: async ({ canvas }) => {
    const linkSelect = canvas.getByTestId("link-workspace-select");
    await userEvent.selectOptions(linkSelect, "proj-alpha");
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      expect(canvas.getByTestId("link-operation-error")).toBeInTheDocument();
    });
    await expect(canvas.getByTestId("link-operation-error")).toHaveTextContent(
      "Failed to link environment",
    );
  },
};

/** Clicking the error message dismisses it. */
export const LinkErrorDismissible: Story = {
  render: () => <DetailRouteWrapper envId="error-env" />,
  play: async ({ canvas }) => {
    const linkSelect = canvas.getByTestId("link-workspace-select");
    await userEvent.selectOptions(linkSelect, "proj-alpha");
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      expect(canvas.getByTestId("link-operation-error")).toBeInTheDocument();
    });
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
    await expect(canvas.getByTestId("unlink-workspace-proj-alpha")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("unlink-workspace-proj-alpha"));
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      expect(canvas.queryByTestId("unlink-workspace-proj-alpha")).not.toBeInTheDocument();
    });
    await expect(canvas.getByTestId("unlink-workspace-proj-beta")).toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// Inline config editing stories
// ---------------------------------------------------------------------------

/** Configuration section shows host and port fields for a local adapter environment. */
export const ConfigFieldsLocalAdapter: Story = {
  render: () => <DetailRouteWrapper envId="env-local-01" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("env-config-section")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-edit-adapter-type")).toHaveTextContent("local");
    await expect(canvas.getByTestId("env-edit-host-button")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-edit-port-button")).toBeInTheDocument();
  },
};

/** Configuration section shows SSH-specific fields for an SSH adapter environment. */
export const ConfigFieldsSshAdapter: Story = {
  render: () => <DetailRouteWrapper envId="env-remote-01" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("env-config-section")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-edit-adapter-type")).toHaveTextContent("ssh");
    await expect(canvas.getByTestId("env-edit-host-button")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-edit-user-button")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-edit-ssh-port-button")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-edit-identity-file-button")).toBeInTheDocument();
  },
};

/** Configuration section shows image and repo fields for a Docker create-mode environment. */
export const ConfigFieldsDockerAdapter: Story = {
  render: () => <DetailRouteWrapper envId="env-docker-01" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("env-config-section")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-edit-adapter-type")).toHaveTextContent("docker");
    await expect(canvas.getByTestId("env-edit-image-button")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-edit-repo-button")).toBeInTheDocument();
  },
};

/** Configuration section shows codespace name field for a codespace adapter environment. */
export const ConfigFieldsCodespaceAdapter: Story = {
  render: () => <DetailRouteWrapper envId="env-cs-01" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("env-config-section")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-edit-adapter-type")).toHaveTextContent("codespace");
    await expect(canvas.getByTestId("env-edit-codespace-name-button")).toBeInTheDocument();
  },
};

/** Clicking the environment name field allows inline editing and reflects the change. */
export const InlineEditNameSaves: Story = {
  render: () => <DetailRouteWrapper envId="env-local-01" />,
  play: async ({ canvas }) => {
    const nameButton = canvas.getByTestId("env-edit-name-button");
    await expect(nameButton).toBeInTheDocument();
    await userEvent.click(nameButton);
    const input = canvas.getByRole("textbox", { name: "Environment name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed Local Env");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      expect(canvas.getByTestId("env-edit-name-button")).toHaveTextContent("Renamed Local Env");
    });
  },
};

/** The old Edit Config button no longer exists on the detail page. */
export const EditConfigButtonRemoved: Story = {
  render: () => <DetailRouteWrapper envId="env-local-01" />,
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId("env-edit-btn")).not.toBeInTheDocument();
  },
};
