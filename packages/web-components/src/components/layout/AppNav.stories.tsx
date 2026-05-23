import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { Brain, ClipboardList, Home, MessageSquare, Monitor, Search, Settings } from "lucide-react";
import { AppNav } from "./AppNav.js";
import { ICON_LG } from "../../utils/iconSize.js";
import { HOME_URL, CHAT_URL, ENVIRONMENTS_URL, SETTINGS_CREDENTIALS_URL, TASKS_URL, FINDINGS_URL, KNOWLEDGE_URL } from "../../utils/navigation.js";

const meta: Meta<typeof AppNav> = {
  title: "Grackle/Layout/AppNav",
  tags: ["autodocs"],
  component: AppNav,
};
export default meta;
type Story = StoryObj<typeof meta>;

/** All tabs rendered (default behavior, no tabs prop). */
export const AllTabsRendered: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /Dashboard/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Sessions/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Tasks/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Environments/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Knowledge/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Settings/ })).toBeInTheDocument();
  },
};

/** Core-only tabs: orchestration (Tasks, Findings) and knowledge tabs are absent. */
export const CoreOnlyTabs: Story = {
  args: {
    tabs: [
      { view: "dashboard", label: "Dashboard", icon: <Home size={ICON_LG} />, route: HOME_URL, testId: "sidebar-tab-dashboard" },
      { view: "chat", label: "Sessions", icon: <MessageSquare size={ICON_LG} />, route: CHAT_URL, testId: "sidebar-tab-chat" },
      { view: "environments", label: "Environments", icon: <Monitor size={ICON_LG} />, route: ENVIRONMENTS_URL, testId: "sidebar-tab-environments" },
      { view: "settings", label: "Settings", icon: <Settings size={ICON_LG} />, route: SETTINGS_CREDENTIALS_URL, testId: "sidebar-tab-settings" },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /Dashboard/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Sessions/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Environments/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Settings/ })).toBeInTheDocument();
    await expect(canvas.queryByRole("tab", { name: /Tasks/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tab", { name: /Findings/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tab", { name: /Knowledge/ })).not.toBeInTheDocument();
  },
};

/** All tabs explicitly provided via tabs prop. */
export const AllTabsExplicit: Story = {
  args: {
    tabs: [
      { view: "dashboard", label: "Dashboard", icon: <Home size={ICON_LG} />, route: HOME_URL, testId: "sidebar-tab-dashboard" },
      { view: "chat", label: "Sessions", icon: <MessageSquare size={ICON_LG} />, route: CHAT_URL, testId: "sidebar-tab-chat" },
      { view: "tasks", label: "Tasks", icon: <ClipboardList size={ICON_LG} />, route: TASKS_URL, testId: "sidebar-tab-tasks" },
      { view: "environments", label: "Environments", icon: <Monitor size={ICON_LG} />, route: ENVIRONMENTS_URL, testId: "sidebar-tab-environments" },
      { view: "knowledge", label: "Knowledge", icon: <Brain size={ICON_LG} />, route: KNOWLEDGE_URL, testId: "sidebar-tab-knowledge" },
      { view: "findings", label: "Findings", icon: <Search size={ICON_LG} />, route: FINDINGS_URL, testId: "sidebar-tab-findings" },
      { view: "settings", label: "Settings", icon: <Settings size={ICON_LG} />, route: SETTINGS_CREDENTIALS_URL, testId: "sidebar-tab-settings" },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /Tasks/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Findings/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Knowledge/ })).toBeInTheDocument();
  },
};

/**
 * Settings is pinned to the right edge even when the incoming tab list places it
 * mid-list (as `buildTabs` does: core tabs, including Settings, come before
 * orchestration and knowledge tabs). The component reorders end-aligned tabs last.
 */
export const SettingsPinnedRight: Story = {
  // Fullscreen so the nav fills the viewport and the auto margin has free space
  // to absorb (otherwise margin-left: auto would resolve to 0).
  parameters: { layout: "fullscreen" },
  args: {
    tabs: [
      { view: "dashboard", label: "Dashboard", icon: <Home size={ICON_LG} />, route: HOME_URL, testId: "sidebar-tab-dashboard" },
      { view: "chat", label: "Sessions", icon: <MessageSquare size={ICON_LG} />, route: CHAT_URL, testId: "sidebar-tab-chat" },
      { view: "environments", label: "Environments", icon: <Monitor size={ICON_LG} />, route: ENVIRONMENTS_URL, testId: "sidebar-tab-environments" },
      { view: "settings", label: "Settings", icon: <Settings size={ICON_LG} />, route: SETTINGS_CREDENTIALS_URL, testId: "sidebar-tab-settings", align: "end" },
      { view: "tasks", label: "Tasks", icon: <ClipboardList size={ICON_LG} />, route: TASKS_URL, testId: "sidebar-tab-tasks" },
      { view: "findings", label: "Findings", icon: <Search size={ICON_LG} />, route: FINDINGS_URL, testId: "sidebar-tab-findings" },
      { view: "knowledge", label: "Knowledge", icon: <Brain size={ICON_LG} />, route: KNOWLEDGE_URL, testId: "sidebar-tab-knowledge" },
    ],
  },
  play: async ({ canvas }) => {
    const renderedTabs = canvas.getAllByRole("tab");
    // Despite Settings being 4th in the input, it must render last (rightmost).
    const settingsTab = renderedTabs[renderedTabs.length - 1];
    await expect(settingsTab).toHaveAccessibleName(/Settings/);

    // The end-alignment lives on the flex item (the Tooltip wrapper around the
    // button), not the button itself. Verify margin-left: auto resolves to a
    // positive used value there, so Settings is actually pushed to the right edge.
    const settingsFlexItem = settingsTab.parentElement;
    if (!settingsFlexItem) {
      throw new Error("expected the Settings tab to have a flex-item wrapper");
    }
    const settingsMarginLeft = Number.parseFloat(globalThis.getComputedStyle(settingsFlexItem).marginLeft);
    await expect(settingsMarginLeft).toBeGreaterThan(0);

    // The neighbor immediately before it (Knowledge) must NOT have an auto
    // margin, confirming the spacer is applied only to the pinned tab.
    const neighborFlexItem = renderedTabs[renderedTabs.length - 2].parentElement;
    if (!neighborFlexItem) {
      throw new Error("expected the neighbor tab to have a flex-item wrapper");
    }
    const neighborMarginLeft = Number.parseFloat(globalThis.getComputedStyle(neighborFlexItem).marginLeft);
    await expect(neighborMarginLeft).toBe(0);
  },
};

/** Arrow keys navigate between tabs horizontally. */
export const KeyboardNavigation: Story = {
  play: async ({ canvas }) => {
    const tabs = canvas.getAllByRole("tab");
    tabs[0].focus();
    await expect(tabs[0]).toHaveFocus();

    // ArrowRight moves to next tab
    await userEvent.keyboard("{ArrowRight}");
    await expect(tabs[1]).toHaveFocus();

    // ArrowLeft moves back
    await userEvent.keyboard("{ArrowLeft}");
    await expect(tabs[0]).toHaveFocus();

    // End jumps to last, Home jumps to first
    await userEvent.keyboard("{End}");
    await expect(tabs[tabs.length - 1]).toHaveFocus();
    await userEvent.keyboard("{Home}");
    await expect(tabs[0]).toHaveFocus();
  },
};

/** J/K keys navigate between tabs (vim-style aliases). */
export const JKNavigation: Story = {
  play: async ({ canvas }) => {
    const tabs = canvas.getAllByRole("tab");
    tabs[0].focus();

    // J moves to next tab
    await userEvent.keyboard("j");
    await expect(tabs[1]).toHaveFocus();

    // K moves back
    await userEvent.keyboard("k");
    await expect(tabs[0]).toHaveFocus();
  },
};

/** Tab list has correct ARIA attributes. */
export const AriaAttributes: Story = {
  play: async ({ canvas }) => {
    const tablist = canvas.getByRole("tablist");
    await expect(tablist).toHaveAttribute("aria-orientation", "horizontal");
    await expect(tablist).toHaveAttribute("aria-label", "App navigation");
  },
};
