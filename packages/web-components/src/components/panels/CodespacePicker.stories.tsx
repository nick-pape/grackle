import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { CodespacePicker } from "./CodespacePicker.js";

const meta: Meta<typeof CodespacePicker> = {
  title: "App/Panels/CodespacePicker",
  component: CodespacePicker,
  args: {
    codespaceName: "",
    onCodespaceNameChange: fn(),
    envName: "",
    onEnvNameChange: fn(),
    codespaces: [],
    codespaceError: "",
    codespaceListError: "",
    codespaceCreating: false,
    onCreateCodespace: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CodespacePicker>;

/** Empty picker shows the codespace selector with the placeholder option. */
export const EmptyList: Story = {
  play: async ({ canvas }) => {
    const select = canvas.getByTestId("env-codespace-select");
    await expect(select).toBeInTheDocument();
  },
};

/** Existing codespaces appear in the dropdown. */
export const WithCodespaces: Story = {
  args: {
    codespaces: [
      { name: "my-space", repository: "owner/repo", state: "Available", gitStatus: "" },
      { name: "other-space", repository: "owner/other", state: "Shutdown", gitStatus: "" },
    ],
  },
  play: async ({ canvas }) => {
    const select = canvas.getByTestId("env-codespace-select") as HTMLSelectElement;
    await expect(select).toBeInTheDocument();
    await expect(canvas.getByText(/my-space/)).toBeInTheDocument();
    await expect(canvas.getByText(/other-space/)).toBeInTheDocument();
  },
};

/** While a codespace is being created the dropdown is disabled. */
export const Creating: Story = {
  args: {
    codespaceCreating: true,
    codespaces: [{ name: "wip-space", repository: "owner/repo", state: "Creating", gitStatus: "" }],
  },
  play: async ({ canvas }) => {
    const select = canvas.getByTestId("env-codespace-select") as HTMLSelectElement;
    await expect(select).toBeDisabled();
    await expect(canvas.getByText(/Creating codespace/)).toBeInTheDocument();
  },
};

/** When listing fails the manual entry input appears instead of the dropdown. */
export const ListError: Story = {
  args: {
    codespaceListError: "Could not find the `gh` CLI.",
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId("env-codespace-select")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("env-codespace-manual")).toBeInTheDocument();
    await expect(canvas.getByText(/gh/)).toBeInTheDocument();
  },
};

/** A codespace op error (non-list) is shown below the dropdown. */
export const OperationError: Story = {
  args: {
    codespaceError: "Failed to start codespace",
    codespaces: [{ name: "my-space", repository: "owner/repo", state: "Available", gitStatus: "" }],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("env-codespace-select")).toBeInTheDocument();
    await expect(canvas.getByText(/Failed to start codespace/)).toBeInTheDocument();
  },
};

/** Choosing "Create new from repo..." switches to the create form. */
export const CreateMode: Story = {
  args: {
    codespaces: [{ name: "my-space", repository: "owner/repo", state: "Available", gitStatus: "" }],
  },
  play: async ({ canvas }) => {
    const select = canvas.getByTestId("env-codespace-select");
    await userEvent.selectOptions(select, "__create__");
    await expect(canvas.getByTestId("env-codespace-repo")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-codespace-machine")).toBeInTheDocument();
  },
};
