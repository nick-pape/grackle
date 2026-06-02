import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { AgentTabBar } from "./AgentTabBar.js";

const meta: Meta<typeof AgentTabBar> = {
  title: "Grackle/Agents/AgentTabBar",
  tags: ["autodocs"],
  component: AgentTabBar,
  args: {
    agentId: "agent-001",
    activeTab: "chat",
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Chat tab is active (default). */
export const ChatActive: Story = {
  play: async ({ canvas }) => {
    const chatTab = canvas.getByTestId("agent-tab-chat");
    await expect(chatTab).toHaveAttribute("aria-selected", "true");
    await expect(chatTab).toHaveAttribute("tabindex", "0");

    // Other tabs are not selected
    await expect(canvas.getByTestId("agent-tab-sessions")).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await expect(canvas.getByTestId("agent-tab-schedules")).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await expect(canvas.getByTestId("agent-tab-settings")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  },
};

/** Sessions tab is active. */
export const SessionsActive: Story = {
  args: { activeTab: "sessions" },
  play: async ({ canvas }) => {
    const sessionsTab = canvas.getByTestId("agent-tab-sessions");
    await expect(sessionsTab).toHaveAttribute("aria-selected", "true");
    await expect(sessionsTab).toHaveAttribute("tabindex", "0");

    await expect(canvas.getByTestId("agent-tab-chat")).toHaveAttribute("aria-selected", "false");
  },
};

/** Schedules tab is active. */
export const SchedulesActive: Story = {
  args: { activeTab: "schedules" },
  play: async ({ canvas }) => {
    const schedulesTab = canvas.getByTestId("agent-tab-schedules");
    await expect(schedulesTab).toHaveAttribute("aria-selected", "true");
    await expect(schedulesTab).toHaveAttribute("tabindex", "0");

    await expect(canvas.getByTestId("agent-tab-chat")).toHaveAttribute("aria-selected", "false");
  },
};

/** Settings tab is active. */
export const SettingsActive: Story = {
  args: { activeTab: "settings" },
  play: async ({ canvas }) => {
    const settingsTab = canvas.getByTestId("agent-tab-settings");
    await expect(settingsTab).toHaveAttribute("aria-selected", "true");
    await expect(settingsTab).toHaveAttribute("tabindex", "0");

    await expect(canvas.getByTestId("agent-tab-chat")).toHaveAttribute("aria-selected", "false");
  },
};

/**
 * Arrow keys fire on the tablist without errors. Full focus-follows-navigation
 * behavior requires the real router (tested in E2E via agent-view.spec.ts).
 */
export const KeyboardNavigation: Story = {
  play: async ({ canvas }) => {
    const tabs = canvas.getAllByRole("tab");
    tabs[0].focus();
    await expect(tabs[0]).toHaveFocus();

    // Arrow keys fire without throwing (navigation triggers a re-render in
    // Storybook's MemoryRouter, so focus assertions on the *next* tab are
    // unreliable here - the activeTab prop stays "chat" from args).
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowLeft}");
    await userEvent.keyboard("{End}");
    await userEvent.keyboard("{Home}");
  },
};

/** Tab list has correct ARIA attributes for horizontal navigation. */
export const AriaAttributes: Story = {
  play: async ({ canvas }) => {
    const tablist = canvas.getByRole("tablist");
    await expect(tablist).toHaveAttribute("aria-orientation", "horizontal");
    await expect(tablist).toHaveAttribute("aria-label", "Agent navigation");

    // All four tabs are present
    const tabs = canvas.getAllByRole("tab");
    await expect(tabs).toHaveLength(4);

    // Inactive tabs have tabindex -1 (roving tabindex pattern)
    await expect(canvas.getByTestId("agent-tab-sessions")).toHaveAttribute("tabindex", "-1");
    await expect(canvas.getByTestId("agent-tab-schedules")).toHaveAttribute("tabindex", "-1");
    await expect(canvas.getByTestId("agent-tab-settings")).toHaveAttribute("tabindex", "-1");
  },
};
