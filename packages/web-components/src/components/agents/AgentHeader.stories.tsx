import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { AgentHeader } from "./AgentHeader.js";
import { makeSchedule } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof AgentHeader> = {
  title: "Grackle/Agents/AgentHeader",
  tags: ["autodocs"],
  component: AgentHeader,
  args: {
    name: "Research Agent",
    avatar: "",
    onNavigateBack: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default state: name with empty avatar shows a monogram fallback. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("agent-header-name")).toHaveTextContent("Research Agent");
    // Empty avatar falls back to monogram (first letter of name)
    const glyph = canvas.getByTestId("agent-header-avatar-glyph");
    await expect(glyph).toHaveTextContent("R");
    await expect(glyph).toHaveAttribute("aria-hidden", "true");
  },
};

/** Avatar is an emoji character. */
export const WithEmoji: Story = {
  args: {
    name: "Scout",
    avatar: "🦉",
  },
  play: async ({ canvas }) => {
    const glyph = canvas.getByTestId("agent-header-avatar-glyph");
    await expect(glyph).toHaveTextContent("🦉");
  },
};

/** Heartbeat schedule is set and enabled - shows next wake and last activity. */
export const WithHeartbeatActive: Story = {
  args: {
    name: "Cron Agent",
    avatar: "⏰",
    heartbeat: makeSchedule({
      enabled: true,
      nextRunAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      lastRunAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("agent-header-next-wake")).toBeInTheDocument();
    await expect(canvas.getByTestId("agent-header-last-activity")).toBeInTheDocument();
    // "Paused" should not appear when enabled
    await expect(canvas.queryByTestId("agent-header-paused")).not.toBeInTheDocument();
  },
};

/** Heartbeat schedule exists but is paused (disabled). */
export const WithHeartbeatPaused: Story = {
  args: {
    name: "Paused Agent",
    avatar: "⏸️",
    heartbeat: makeSchedule({
      enabled: false,
      lastRunAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("agent-header-paused")).toHaveTextContent("Paused");
    // "Next wake" should not appear when disabled
    await expect(canvas.queryByTestId("agent-header-next-wake")).not.toBeInTheDocument();
    // Last activity is still shown
    await expect(canvas.getByTestId("agent-header-last-activity")).toBeInTheDocument();
  },
};

/** No heartbeat - just name and avatar, no status line. */
export const NoHeartbeat: Story = {
  args: {
    name: "Simple Agent",
    avatar: "",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("agent-header-name")).toHaveTextContent("Simple Agent");
    // No status section at all
    await expect(canvas.queryByTestId("agent-header-status")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("agent-header-next-wake")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("agent-header-paused")).not.toBeInTheDocument();
  },
};
