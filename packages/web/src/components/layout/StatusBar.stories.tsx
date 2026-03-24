import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { StatusBar } from "./StatusBar.js";
import { makeEnvironment, makeSession } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof StatusBar> = {
  component: StatusBar,
  args: {
    connected: true,
    environments: [makeEnvironment({ id: "local", displayName: "Local", status: "connected" })],
    sessions: [makeSession({ status: "running" })],
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Connected state with 1 environment and 1 active session. */
export const Connected: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Connected")).toBeInTheDocument();
    await expect(canvas.getByText("Connected")).toBeInTheDocument();
    await expect(canvas.getByText("1/1 env")).toBeInTheDocument();
    await expect(canvas.getByText("1 active")).toBeInTheDocument();
  },
};

/** Disconnected state. */
export const Disconnected: Story = {
  args: {
    connected: false,
    environments: [],
    sessions: [],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Disconnected")).toBeInTheDocument();
    await expect(canvas.getByText("0/0 envs")).toBeInTheDocument();
    await expect(canvas.getByText("0 active")).toBeInTheDocument();
  },
};

/** Multiple environments — some connected, some not. */
export const MultipleEnvironments: Story = {
  args: {
    environments: [
      makeEnvironment({ id: "e1", status: "connected" }),
      makeEnvironment({ id: "e2", status: "disconnected" }),
      makeEnvironment({ id: "e3", status: "connected" }),
    ],
    sessions: [
      makeSession({ id: "s1", status: "running" }),
      makeSession({ id: "s2", status: "idle" }),
      makeSession({ id: "s3", status: "stopped" }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("2/3 envs")).toBeInTheDocument();
    await expect(canvas.getByText("2 active")).toBeInTheDocument();
  },
};
