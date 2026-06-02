import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { Brain, ClipboardList, Home, MessageSquare, Monitor, Settings } from "lucide-react";
import { AppNav } from "./AppNav.js";
import { ICON_LG } from "../../utils/iconSize.js";
import {
  HOME_URL,
  CHAT_URL,
  ENVIRONMENTS_URL,
  SETTINGS_CREDENTIALS_URL,
  TASKS_URL,
  KNOWLEDGE_URL,
} from "../../utils/navigation.js";

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
    await expect(canvas.getByRole("tab", { name: /Root/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Tasks/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Environments/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Knowledge/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Schedules/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Settings/ })).toBeInTheDocument();
  },
};

/** Core-only tabs: orchestration (Tasks) and knowledge tabs are absent. */
export const CoreOnlyTabs: Story = {
  args: {
    tabs: [
      {
        view: "dashboard",
        label: "Dashboard",
        icon: <Home size={ICON_LG} />,
        route: HOME_URL,
        testId: "sidebar-tab-dashboard",
      },
      {
        view: "chat",
        label: "Root",
        icon: <MessageSquare size={ICON_LG} />,
        route: CHAT_URL,
        testId: "sidebar-tab-chat",
      },
      {
        view: "environments",
        label: "Environments",
        icon: <Monitor size={ICON_LG} />,
        route: ENVIRONMENTS_URL,
        testId: "sidebar-tab-environments",
      },
      {
        view: "settings",
        label: "Settings",
        icon: <Settings size={ICON_LG} />,
        route: SETTINGS_CREDENTIALS_URL,
        testId: "sidebar-tab-settings",
      },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /Dashboard/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Root/ })).toBeInTheDocument();
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
      {
        view: "dashboard",
        label: "Dashboard",
        icon: <Home size={ICON_LG} />,
        route: HOME_URL,
        testId: "sidebar-tab-dashboard",
      },
      {
        view: "chat",
        label: "Root",
        icon: <MessageSquare size={ICON_LG} />,
        route: CHAT_URL,
        testId: "sidebar-tab-chat",
      },
      {
        view: "tasks",
        label: "Tasks",
        icon: <ClipboardList size={ICON_LG} />,
        route: TASKS_URL,
        testId: "sidebar-tab-tasks",
      },
      {
        view: "environments",
        label: "Environments",
        icon: <Monitor size={ICON_LG} />,
        route: ENVIRONMENTS_URL,
        testId: "sidebar-tab-environments",
      },
      {
        view: "knowledge",
        label: "Knowledge",
        icon: <Brain size={ICON_LG} />,
        route: KNOWLEDGE_URL,
        testId: "sidebar-tab-knowledge",
      },
      {
        view: "settings",
        label: "Settings",
        icon: <Settings size={ICON_LG} />,
        route: SETTINGS_CREDENTIALS_URL,
        testId: "sidebar-tab-settings",
      },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /Tasks/ })).toBeInTheDocument();
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
      {
        view: "dashboard",
        label: "Dashboard",
        icon: <Home size={ICON_LG} />,
        route: HOME_URL,
        testId: "sidebar-tab-dashboard",
      },
      {
        view: "chat",
        label: "Root",
        icon: <MessageSquare size={ICON_LG} />,
        route: CHAT_URL,
        testId: "sidebar-tab-chat",
      },
      {
        view: "environments",
        label: "Environments",
        icon: <Monitor size={ICON_LG} />,
        route: ENVIRONMENTS_URL,
        testId: "sidebar-tab-environments",
      },
      {
        view: "settings",
        label: "Settings",
        icon: <Settings size={ICON_LG} />,
        route: SETTINGS_CREDENTIALS_URL,
        testId: "sidebar-tab-settings",
        align: "end",
      },
      {
        view: "tasks",
        label: "Tasks",
        icon: <ClipboardList size={ICON_LG} />,
        route: TASKS_URL,
        testId: "sidebar-tab-tasks",
      },
      {
        view: "knowledge",
        label: "Knowledge",
        icon: <Brain size={ICON_LG} />,
        route: KNOWLEDGE_URL,
        testId: "sidebar-tab-knowledge",
      },
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
    const settingsMarginLeft = Number.parseFloat(
      globalThis.getComputedStyle(settingsFlexItem).marginLeft,
    );
    await expect(settingsMarginLeft).toBeGreaterThan(0);

    // The neighbor immediately before it (Knowledge) must NOT have an auto
    // margin, confirming the spacer is applied only to the pinned tab.
    const neighborFlexItem = renderedTabs[renderedTabs.length - 2].parentElement;
    if (!neighborFlexItem) {
      throw new Error("expected the neighbor tab to have a flex-item wrapper");
    }
    const neighborMarginLeft = Number.parseFloat(
      globalThis.getComputedStyle(neighborFlexItem).marginLeft,
    );
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

/**
 * Default canonical TABS: Settings (the sole remaining `global` tab) is
 * pinned to the right edge after the workbench/fleet views (#1414, #1419).
 * Environments moved to fleet in #1419.
 */
export const GlobalClusterEndAligned: Story = {
  play: async ({ canvas }) => {
    const tabs = canvas.getAllByRole("tab");
    // Settings is rightmost (sole global/end-aligned tab after #1419).
    await expect(tabs[tabs.length - 1]).toHaveAccessibleName(/Settings/);
    // Workbench views lead the row.
    await expect(tabs[0]).toHaveAccessibleName(/Dashboard/);
  },
};

/**
 * The `groups` filter restricts the bar to chosen axes — the lever #1415 uses to
 * pull `fleet`/`global` tabs out of the view bar. Here only workbench + fleet
 * render, so Settings (`global`) is absent. Environments and Personas are fleet
 * since #1419, so they appear here.
 */
export const WorkbenchAndFleetOnly: Story = {
  args: { groups: ["workbench", "fleet"] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /Tasks/ })).toBeInTheDocument();
    // Fleet surfaces: Coordination, Personas, Environments, Schedules (#1419).
    await expect(canvas.getByRole("tab", { name: /Coordination/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Personas/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Environments/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Schedules/ })).toBeInTheDocument();
    // Settings remains global, so absent here.
    await expect(canvas.queryByRole("tab", { name: /Settings/ })).not.toBeInTheDocument();
  },
};

/**
 * The composition the app actually ships (#1415, #1419): the view bar renders
 * only `workbench` + `global` tabs, so all `fleet` tabs are pulled out —
 * Coordination, Personas, Environments, and Schedules now live at the fleet
 * altitude in the context rail.
 */
export const WorkbenchAndGlobalOnly: Story = {
  args: { groups: ["workbench", "global"] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /Tasks/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Settings/ })).toBeInTheDocument();
    // All fleet tabs absent from the workbench+global bar.
    await expect(canvas.queryByRole("tab", { name: /Coordination/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tab", { name: /Personas/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tab", { name: /Environments/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tab", { name: /Schedules/ })).not.toBeInTheDocument();
  },
};
