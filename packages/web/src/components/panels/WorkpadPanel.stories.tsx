import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { WorkpadPanel } from "./WorkpadPanel.js";

const meta: Meta<typeof WorkpadPanel> = {
  title: "Panels/WorkpadPanel",
  component: WorkpadPanel,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const WithFullWorkpad: Story = {
  args: {
    workpad: JSON.stringify({
      status: "completed",
      summary: "Implemented JWT auth middleware with tests. Opened PR #475.",
      extra: { branch: "feat/auth-middleware", pr: 475, files_changed: 3 },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("workpad-status")).toHaveTextContent("completed");
    await expect(canvas.getByTestId("workpad-summary")).toHaveTextContent("JWT auth middleware");
    await expect(canvas.getByTestId("workpad-extra")).toHaveTextContent("feat/auth-middleware");
  },
};

export const StatusOnly: Story = {
  args: {
    workpad: JSON.stringify({ status: "blocked" }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("workpad-status")).toHaveTextContent("blocked");
    await expect(canvas.queryByTestId("workpad-summary")).toBeNull();
    await expect(canvas.queryByTestId("workpad-extra")).toBeNull();
  },
};

export const EmptyWorkpad: Story = {
  args: {
    workpad: "",
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId("workpad-panel")).toBeNull();
  },
};

export const InvalidJson: Story = {
  args: {
    workpad: "this is not json",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("workpad-panel")).toBeInTheDocument();
    await expect(canvas.getByText("this is not json")).toBeInTheDocument();
  },
};
