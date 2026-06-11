import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { DockerContainerPicker } from "./DockerContainerPicker.js";

const meta: Meta<typeof DockerContainerPicker> = {
  title: "App/Panels/DockerContainerPicker",
  component: DockerContainerPicker,
  args: {
    dockerMode: "create",
    onDockerModeChange: fn(),
    image: "",
    onImageChange: fn(),
    repo: "",
    onRepoChange: fn(),
    attachContainer: "",
    onAttachContainerChange: fn(),
    envName: "",
    onEnvNameChange: fn(),
    dockerContainers: [],
    dockerContainersError: "",
    onListDockerContainers: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof DockerContainerPicker>;

/** Default create mode shows image and repo fields. */
export const CreateMode: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("env-docker-mode")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-create-image")).toBeInTheDocument();
    await expect(canvas.getByTestId("env-create-repo")).toBeInTheDocument();
  },
};

/** Switching to attach mode requests the container list. */
export const SwitchToAttach: Story = {
  play: async ({ canvas, args }) => {
    const modeSelect = canvas.getByTestId("env-docker-mode");
    await userEvent.selectOptions(modeSelect, "attach");
    await expect(args.onDockerModeChange).toHaveBeenCalledWith("attach");
    await expect(args.onListDockerContainers).toHaveBeenCalled();
  },
};

/** Attach mode with containers shows the container dropdown. */
export const AttachWithContainers: Story = {
  args: {
    dockerMode: "attach",
    dockerContainers: [
      { id: "abc123", name: "demo-ext", image: "node:22", state: "running", status: "Up 3m" },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("env-docker-container-select")).toBeInTheDocument();
    await expect(canvas.queryByTestId("env-create-image")).not.toBeInTheDocument();
  },
};

/** Attach mode with a listing error shows the manual entry input. */
export const AttachListError: Story = {
  args: {
    dockerMode: "attach",
    dockerContainersError: "docker: command not found",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("env-docker-container-manual")).toBeInTheDocument();
    await expect(canvas.queryByTestId("env-docker-container-select")).not.toBeInTheDocument();
    await expect(canvas.getByText(/docker: command not found/)).toBeInTheDocument();
  },
};

/** Attach mode with no running containers shows the manual entry input. */
export const AttachEmptyList: Story = {
  args: {
    dockerMode: "attach",
    dockerContainers: [],
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId("env-docker-container-select")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("env-docker-container-manual")).toBeInTheDocument();
    await expect(canvas.getByText(/No running containers found/)).toBeInTheDocument();
  },
};
