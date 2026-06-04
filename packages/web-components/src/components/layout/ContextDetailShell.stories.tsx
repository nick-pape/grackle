import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { Activity, MessageSquare, Settings } from "lucide-react";
import { ContextDetailShell, AGENT_DETAIL_TABS, CODE_HEADER_ICON } from "./ContextDetailShell.js";
import type { ContextDetailTab } from "./ContextDetailShell.js";
import { CodeHeaderStatus } from "./CodeHeaderStatus.js";

const ICON_SIZE: number = 18;

const CODE_TABS: ContextDetailTab[] = [
  { id: "chat", label: "Chat", icon: <MessageSquare size={ICON_SIZE} />, testId: "tab-chat" },
  {
    id: "sessions",
    label: "Sessions",
    icon: <Activity size={ICON_SIZE} />,
    testId: "tab-sessions",
  },
  {
    id: "settings",
    label: "Settings",
    icon: <Settings size={ICON_SIZE} />,
    testId: "tab-settings",
    align: "end",
  },
];

const onNavigateBack: ReturnType<typeof fn> = fn();
const onSelectTab: ReturnType<typeof fn> = fn();

const meta: Meta<typeof ContextDetailShell> = {
  title: "Grackle/Layout/ContextDetailShell",
  tags: ["autodocs"],
  component: ContextDetailShell,
  args: {
    onNavigateBack,
    onSelectTab,
  },
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const CodeContext: Story = {
  args: {
    icon: CODE_HEADER_ICON,
    name: "Code",
    statusContent: (
      <CodeHeaderStatus
        summary={{
          activeCount: 2,
          lastActivityAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        }}
      />
    ),
    tabs: CODE_TABS,
    activeTab: "chat",
    ariaLabel: "App navigation",
    headerTestId: "code-header",
    tabBarTestId: "code-tab-bar",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("code-header-name")).toHaveTextContent("Code");
    await expect(canvas.getByTestId("code-header-back")).toBeInTheDocument();
    await expect(canvas.getByTestId("code-header-status")).toBeInTheDocument();
    await expect(canvas.getByTestId("code-header-active-sessions")).toHaveTextContent(
      "2 active sessions",
    );
    await expect(canvas.getByTestId("code-header-last-activity")).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Chat/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Sessions/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Settings/ })).toBeInTheDocument();
  },
};

export const CodeContextNoSessions: Story = {
  args: {
    icon: CODE_HEADER_ICON,
    name: "Code",
    statusContent: <CodeHeaderStatus summary={{ activeCount: 0, lastActivityAt: undefined }} />,
    tabs: CODE_TABS,
    activeTab: "chat",
    ariaLabel: "App navigation",
    headerTestId: "code-header",
    tabBarTestId: "code-tab-bar",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("code-header-name")).toHaveTextContent("Code");
    const status = canvas.queryByTestId("code-header-status");
    await expect(status).toBeNull();
  },
};

export const AgentContext: Story = {
  args: {
    icon: <span aria-hidden="true">R</span>,
    name: "ResearchBot",
    tabs: AGENT_DETAIL_TABS,
    activeTab: "chat",
    statusContent: (
      <div style={{ display: "flex", gap: "var(--space-md)" }}>
        <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)" }}>
          Next wake in 5m
        </span>
        <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)" }}>
          Last activity 2h ago
        </span>
      </div>
    ),
    ariaLabel: "Agent navigation",
    headerTestId: "agent-header",
    tabBarTestId: "agent-tab-bar",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("agent-header-name")).toHaveTextContent("ResearchBot");
    await expect(canvas.getByText("Next wake in 5m")).toBeInTheDocument();
    await expect(canvas.getByText("Last activity 2h ago")).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Chat/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Settings/ })).toBeInTheDocument();
  },
};

export const SettingsEndAligned: Story = {
  args: {
    icon: CODE_HEADER_ICON,
    name: "Code",
    tabs: CODE_TABS,
    activeTab: "chat",
    headerTestId: "code-header",
    tabBarTestId: "code-tab-bar",
  },
  play: async ({ canvas }) => {
    const tabs = canvas.getAllByRole("tab");
    await expect(tabs[tabs.length - 1]).toHaveAccessibleName(/Settings/);

    const settingsFlexItem = tabs[tabs.length - 1].parentElement;
    if (!settingsFlexItem) {
      throw new Error("expected the Settings tab to have a flex-item wrapper");
    }
    const settingsMarginLeft = Number.parseFloat(
      globalThis.getComputedStyle(settingsFlexItem).marginLeft,
    );
    await expect(settingsMarginLeft).toBeGreaterThan(0);
  },
};

export const KeyboardNavigation: Story = {
  args: {
    icon: CODE_HEADER_ICON,
    name: "Code",
    tabs: CODE_TABS,
    activeTab: "chat",
    headerTestId: "code-header",
    tabBarTestId: "code-tab-bar",
    onSelectTab: () => {},
  },
  play: async ({ canvas }) => {
    const tabs = canvas.getAllByRole("tab");
    tabs[0].focus();
    await expect(tabs[0]).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");
    await expect(tabs[1]).toHaveFocus();

    await userEvent.keyboard("{ArrowLeft}");
    await expect(tabs[0]).toHaveFocus();

    await userEvent.keyboard("{End}");
    await expect(tabs[tabs.length - 1]).toHaveFocus();

    await userEvent.keyboard("{Home}");
    await expect(tabs[0]).toHaveFocus();
  },
};

export const AriaAttributes: Story = {
  args: {
    icon: CODE_HEADER_ICON,
    name: "Code",
    tabs: AGENT_DETAIL_TABS,
    activeTab: "sessions",
    ariaLabel: "Agent navigation",
    headerTestId: "code-header",
    tabBarTestId: "code-tab-bar",
  },
  play: async ({ canvas }) => {
    const tablist = canvas.getByRole("tablist");
    await expect(tablist).toHaveAttribute("aria-orientation", "horizontal");
    await expect(tablist).toHaveAttribute("aria-label", "Agent navigation");

    const tabs = canvas.getAllByRole("tab");
    await expect(tabs).toHaveLength(4);

    const sessionsTab = canvas.getByRole("tab", { name: /Sessions/ });
    await expect(sessionsTab).toHaveAttribute("aria-selected", "true");
    await expect(sessionsTab).toHaveAttribute("tabindex", "0");

    const chatTab = canvas.getByRole("tab", { name: /Chat/ });
    await expect(chatTab).toHaveAttribute("aria-selected", "false");
    await expect(chatTab).toHaveAttribute("tabindex", "-1");
  },
};
