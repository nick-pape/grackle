import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { EnvironmentEditPanel } from "./EnvironmentEditPanel.js";
import { buildEnvironment } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof EnvironmentEditPanel> = {
  title: "App/Panels/EnvironmentEditPanel",
  component: EnvironmentEditPanel,
  args: {
    mode: "new",
    environments: [],
    githubAccounts: [],
    onAddEnvironment: fn(),
    onUpdateEnvironment: fn(),
    onListCodespaces: fn(),
    codespaces: [],
    codespaceError: "",
    codespaceListError: "",
    codespaceCreating: false,
    onCreateCodespace: fn(),
    onListDockerContainers: fn(),
    dockerContainers: [],
    dockerContainersError: "",
    onShowToast: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof EnvironmentEditPanel>;

/** The create form renders with default local adapter and an empty name input. */
export const DefaultCreateForm: Story = {
  play: async ({ canvas }) => {
    // Panel should be visible with form elements
    await expect(canvas.getByTestId("env-create-panel")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-create-name")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-create-submit")).toBeInTheDocument();
  },
};

/** Adapter type dropdown defaults to "local". */
export const AdapterDefaultsToLocal: Story = {
  play: async ({ canvas }) => {
    const adapterSelect = canvas.getByTestId("env-create-adapter") as HTMLSelectElement;
    await expect(adapterSelect.value).toBe("local");
  },
};

/** Create button is disabled when the name input is empty. */
export const CreateDisabledWhenEmpty: Story = {
  play: async ({ canvas }) => {
    const createButton = canvas.getByTestId("env-create-submit");
    await expect(createButton).toBeDisabled();
  },
};

/** Create button is enabled when a name is provided for the local adapter. */
export const CreateEnabledWhenNameFilled: Story = {
  play: async ({ canvas }) => {
    const nameInput = canvas.getByTestId("env-create-name");
    await userEvent.type(nameInput, "my-local");

    const createButton = canvas.getByTestId("env-create-submit");
    await expect(createButton).toBeEnabled();
  },
};

/** SSH adapter requires a host field — Create stays disabled without it. */
export const SshRequiresHost: Story = {
  play: async ({ canvas }) => {
    // Select SSH adapter
    const adapterSelect = canvas.getByTestId("env-create-adapter");
    await userEvent.selectOptions(adapterSelect, "ssh");

    // Fill name but leave host empty
    const nameInput = canvas.getByTestId("env-create-name");
    await userEvent.type(nameInput, "my-ssh");

    const createButton = canvas.getByTestId("env-create-submit");
    await expect(createButton).toBeDisabled();

    // Fill host — now it should be enabled
    const hostInput = canvas.getByTestId("env-create-host");
    await userEvent.type(hostInput, "192.168.1.10");
    await expect(createButton).toBeEnabled();
  },
};

/** Create button is disabled when port value is out of the valid range (1-65535). */
export const PortValidation: Story = {
  play: async ({ canvas }) => {
    const nameInput = canvas.getByTestId("env-create-name");
    await userEvent.type(nameInput, "port-test");

    const portInput = canvas.getByTestId("env-create-port");
    const createButton = canvas.getByTestId("env-create-submit");

    // Out-of-range low value
    await userEvent.type(portInput, "0");
    await expect(createButton).toBeDisabled();

    // Clear and try out-of-range high value
    await userEvent.clear(portInput);
    await userEvent.type(portInput, "99999");
    await expect(createButton).toBeDisabled();

    // Valid boundary: 1
    await userEvent.clear(portInput);
    await userEvent.type(portInput, "1");
    await expect(createButton).toBeEnabled();

    // Valid boundary: 65535
    await userEvent.clear(portInput);
    await userEvent.type(portInput, "65535");
    await expect(createButton).toBeEnabled();

    // Clearing port (optional) keeps button enabled
    await userEvent.clear(portInput);
    await expect(createButton).toBeEnabled();
  },
};

/** Switching adapter type shows the correct conditional fields. */
export const SwitchingAdapterShowsFields: Story = {
  play: async ({ canvas }) => {
    const adapterSelect = canvas.getByTestId("env-create-adapter");

    // Local shows host and port
    await expect(canvas.getByTestId("env-create-host")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-create-port")).toBeInTheDocument();

    // Switch to SSH — shows host, user, port, identity file
    await userEvent.selectOptions(adapterSelect, "ssh");
    await expect(canvas.getByTestId("env-create-host")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-create-user")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-create-port")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-create-identity")).toBeInTheDocument();

    // Switch to Docker — shows the source toggle plus image and repo (create mode default)
    await userEvent.selectOptions(adapterSelect, "docker");
    await expect(canvas.getByTestId("env-docker-mode")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-create-image")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-create-repo")).toBeInTheDocument();
  },
};

/** Docker attach mode lists running containers and requests them when selected. */
export const DockerAttachLists: Story = {
  args: {
    dockerContainers: [
      { id: "abc123", name: "demo-ext", image: "node:22", state: "running", status: "Up 3 minutes" },
    ],
  },
  play: async ({ canvas, args }) => {
    const adapterSelect = canvas.getByTestId("env-create-adapter");
    await userEvent.selectOptions(adapterSelect, "docker");

    // Switch the docker source to "attach" — the container list should be requested
    const modeSelect = canvas.getByTestId("env-docker-mode");
    await userEvent.selectOptions(modeSelect, "attach");
    await expect(args.onListDockerContainers).toHaveBeenCalled();

    // The picker replaces the image/repo fields
    await expect(canvas.getByTestId("env-docker-container-select")).toBeInTheDocument();
    await expect(canvas.queryByTestId("env-create-image")).not.toBeInTheDocument();
  },
};

/** Selecting a container in attach mode builds an { attach } config on Create. */
export const DockerAttachCreatesConfig: Story = {
  args: {
    dockerContainers: [
      { id: "abc123", name: "demo-ext", image: "node:22", state: "running", status: "Up 3 minutes" },
    ],
  },
  play: async ({ canvas, args }) => {
    await userEvent.selectOptions(canvas.getByTestId("env-create-adapter"), "docker");
    await userEvent.selectOptions(canvas.getByTestId("env-docker-mode"), "attach");

    // Pick the running container; the env name auto-fills from it
    await userEvent.selectOptions(canvas.getByTestId("env-docker-container-select"), "demo-ext");

    const createButton = canvas.getByTestId("env-create-submit");
    await expect(createButton).toBeEnabled();
    await userEvent.click(createButton);

    await expect(args.onAddEnvironment).toHaveBeenCalledWith(
      "demo-ext",
      "docker",
      { attach: "demo-ext" },
      undefined,
    );
  },
};

/** When docker container listing fails, a manual entry input appears. */
export const DockerAttachManualEntry: Story = {
  args: {
    dockerContainersError: "docker: command not found",
  },
  play: async ({ canvas }) => {
    await userEvent.selectOptions(canvas.getByTestId("env-create-adapter"), "docker");
    await userEvent.selectOptions(canvas.getByTestId("env-docker-mode"), "attach");

    await expect(canvas.getByTestId("env-docker-container-manual")).toBeInTheDocument();
    await expect(canvas.queryByTestId("env-docker-container-select")).not.toBeInTheDocument();
  },
};

/** When discovery succeeds but finds no running containers, manual entry is still offered. */
export const DockerAttachEmptyListManualEntry: Story = {
  args: {
    dockerContainers: [],
  },
  play: async ({ canvas }) => {
    await userEvent.selectOptions(canvas.getByTestId("env-create-adapter"), "docker");
    await userEvent.selectOptions(canvas.getByTestId("env-docker-mode"), "attach");

    // No select (nothing to pick), but a manual input is available
    await expect(canvas.queryByTestId("env-docker-container-select")).not.toBeInTheDocument();
    const manual = canvas.getByTestId("env-docker-container-manual");
    await userEvent.type(manual, "demo-ext");

    const createButton = canvas.getByTestId("env-create-submit");
    await expect(createButton).toBeEnabled();
  },
};

/** When codespace listing fails, a manual entry input appears and the select dropdown is hidden. */
export const CodespaceManualEntry: Story = {
  args: {
    codespaceListError: "Could not find the `gh` CLI.",
  },
  play: async ({ canvas }) => {
    // Select codespace adapter
    const adapterSelect = canvas.getByTestId("env-create-adapter");
    await userEvent.selectOptions(adapterSelect, "codespace");

    // Manual input fallback should appear
    await expect(canvas.getByTestId("env-codespace-manual")).toBeInTheDocument();

    // Error message should be visible
    await expect(canvas.getByText(/gh/)).toBeInTheDocument();

    // Select dropdown should NOT be in the document when list error is present
    const selectEl = canvas.queryByTestId("env-codespace-select");
    await expect(selectEl).not.toBeInTheDocument();
  },
};

/** Manual codespace entry enables the Create button when name and codespace are filled. */
export const CodespaceManualEntryEnablesCreate: Story = {
  args: {
    codespaceListError: "Could not find the `gh` CLI.",
  },
  play: async ({ canvas }) => {
    // Select codespace adapter
    const adapterSelect = canvas.getByTestId("env-create-adapter");
    await userEvent.selectOptions(adapterSelect, "codespace");

    // Fill environment name
    const nameInput = canvas.getByTestId("env-create-name");
    await userEvent.type(nameInput, "my-cs");

    // Fill manual codespace name
    const manualInput = canvas.getByTestId("env-codespace-manual");
    await userEvent.type(manualInput, "my-codespace-name");

    // Create button should be enabled
    const createButton = canvas.getByTestId("env-create-submit");
    await expect(createButton).toBeEnabled();
  },
};

/** Edit mode renders pre-populated fields for an existing environment. */
export const EditModeLocal: Story = {
  args: {
    mode: "edit",
    environmentId: "env-local-01",
    environments: [
      buildEnvironment({
        id: "env-local-01",
        displayName: "My Local Env",
        adapterType: "local",
        adapterConfig: '{"host":"127.0.0.1","port":7434}',
      }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("env-edit-panel")).toBeInTheDocument();
    await expect(canvas.getByText("local")).toBeInTheDocument();
  },
};
