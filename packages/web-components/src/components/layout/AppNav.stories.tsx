import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { Brain, ClipboardList, Home, MessageSquare, Monitor } from "lucide-react";
import { AppNav } from "./AppNav.js";
import { ICON_LG } from "../../utils/iconSize.js";
import {
  HOME_URL,
  CHAT_URL,
  ENVIRONMENTS_URL,
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
    await expect(canvas.getByRole("tab", { name: /Chat/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Tasks/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Environments/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Knowledge/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Schedules/ })).toBeInTheDocument();
    // Settings is no longer in the tab bar — it lives in the ContextNav gear icon.
    await expect(canvas.queryByRole("tab", { name: /Settings/ })).not.toBeInTheDocument();
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
        label: "Chat",
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
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /Dashboard/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Chat/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Environments/ })).toBeInTheDocument();
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
        label: "Chat",
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
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /Tasks/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Knowledge/ })).toBeInTheDocument();
  },
};

/** Settings no longer appears in the tab bar (it moved to the ContextNav gear icon). */

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
 * Default canonical TABS: workbench views lead, fleet views follow.
 * Settings moved to the ContextNav gear icon — no global/end-aligned tabs remain.
 */
export const WorkbenchLeadsFleetFollows: Story = {
  play: async ({ canvas }) => {
    const tabs = canvas.getAllByRole("tab");
    await expect(tabs[0]).toHaveAccessibleName(/Chat/);
    await expect(canvas.queryByRole("tab", { name: /Settings/ })).not.toBeInTheDocument();
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
    // Fleet surfaces: Dashboard, Coordination, Personas, Environments, Schedules.
    await expect(canvas.getByRole("tab", { name: /Dashboard/ })).toBeInTheDocument();
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
 * only `workbench` tabs (Settings moved to ContextNav, so `global` group is
 * empty). All `fleet` tabs live at the fleet altitude in the context rail.
 */
export const WorkbenchOnly: Story = {
  args: { groups: ["workbench", "global"] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /Tasks/ })).toBeInTheDocument();
    // Settings is no longer in the tab bar.
    await expect(canvas.queryByRole("tab", { name: /Settings/ })).not.toBeInTheDocument();
    // All fleet tabs absent from the workbench bar.
    await expect(canvas.queryByRole("tab", { name: /Dashboard/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tab", { name: /Coordination/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tab", { name: /Personas/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tab", { name: /Environments/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tab", { name: /Schedules/ })).not.toBeInTheDocument();
  },
};
