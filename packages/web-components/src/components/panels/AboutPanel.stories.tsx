import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { AboutPanel } from "./AboutPanel.js";
import { buildEnvironment, buildSession } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof AboutPanel> = {
  title: "App/Panels/AboutPanel",
  component: AboutPanel,
  args: {
    connected: true,
    environments: [],
    sessions: [],
  },
};

export default meta;
type Story = StoryObj<typeof AboutPanel>;

/** Connected state with no environments or sessions. */
export const ConnectedEmpty: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("about-panel")).toBeInTheDocument();
    await expect(canvas.getByText("Connected")).toBeInTheDocument();
    await expect(canvas.getByText("0/0 connected")).toBeInTheDocument();
    await expect(canvas.getByText("About")).toBeInTheDocument();
  },
};

/** Disconnected state. */
export const Disconnected: Story = {
  args: {
    connected: false,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Disconnected")).toBeInTheDocument();
  },
};

/** Shows environment and session counts when data is present. */
export const WithEnvironmentsAndSessions: Story = {
  args: {
    connected: true,
    environments: [
      buildEnvironment({ id: "env-1", status: "connected" }),
      buildEnvironment({ id: "env-2", status: "disconnected" }),
      buildEnvironment({ id: "env-3", status: "connected" }),
    ],
    sessions: [
      buildSession({ id: "s-1", status: "running" }),
      buildSession({ id: "s-2", status: "idle" }),
      buildSession({ id: "s-3", status: "stopped" }),
    ],
  },
  play: async ({ canvas }) => {
    // 2 of 3 environments connected
    await expect(canvas.getByText("2/3 connected")).toBeInTheDocument();
    // 2 active sessions (running + idle)
    await expect(canvas.getByText("2")).toBeInTheDocument();
  },
};
