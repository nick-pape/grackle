import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { Bot, Code2, Network } from "lucide-react";
import { ContextNav, type ContextItem } from "./ContextNav.js";
import { ICON_LG } from "../../utils/iconSize.js";

/** Fleet/overview items (Coordination today) rendered above the contexts (#1415). */
const FLEET_ITEMS: ContextItem[] = [
  {
    id: "coordination",
    label: "Coordination",
    icon: <Network size={ICON_LG} />,
    testId: "sidebar-tab-coordination",
  },
];

/** The single Code context shipped in Phase 0. */
const CODE_CONTEXT: ContextItem = {
  id: "code",
  label: "Code",
  icon: <Code2 size={ICON_LG} />,
  testId: "context-code",
};

/** A forward-looking multi-context list (Agent rows arrive in #1417). */
const MULTI_CONTEXTS: ContextItem[] = [
  CODE_CONTEXT,
  { id: "pm-bot", label: "PM bot", icon: <Bot size={ICON_LG} />, testId: "context-pm-bot" },
  {
    id: "triage-bot",
    label: "Triage bot",
    icon: <Bot size={ICON_LG} />,
    testId: "context-triage-bot",
  },
];

const meta: Meta<typeof ContextNav> = {
  title: "Grackle/Layout/ContextNav",
  tags: ["autodocs"],
  component: ContextNav,
  args: {
    contexts: [CODE_CONTEXT],
    activeContextId: "code",
    onSelectContext: fn(),
  },
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default: the Code context, expanded and selected. */
export const CodeSelected: Story = {
  play: async ({ canvas }) => {
    const codeTab = canvas.getByTestId("context-code");
    await expect(codeTab).toBeInTheDocument();
    await expect(codeTab).toHaveAttribute("aria-selected", "true");
    // Expanded: the label text is rendered (not only in a tooltip).
    await expect(codeTab).toHaveTextContent("Code");
  },
};

/** Collapsed: icons only, labels move into tooltips. */
export const Collapsed: Story = {
  args: { collapsed: true, onToggleCollapsed: fn() },
  play: async ({ canvas }) => {
    const rail = canvas.getByTestId("context-nav");
    await expect(rail).toHaveAttribute("data-collapsed", "true");
    // Label is not rendered inline when collapsed.
    await expect(canvas.getByTestId("context-code")).not.toHaveTextContent("Code");
    await expect(canvas.getByTestId("context-nav-toggle")).toBeInTheDocument();
  },
};

/** Selecting a context invokes onSelectContext with its id. */
export const SelectFiresCallback: Story = {
  args: { contexts: MULTI_CONTEXTS, onSelectContext: fn() },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByTestId("context-pm-bot"));
    await expect(args.onSelectContext).toHaveBeenCalledWith("pm-bot");
  },
};

/** The collapse toggle invokes onToggleCollapsed. */
export const ToggleFiresCallback: Story = {
  args: { onToggleCollapsed: fn() },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByTestId("context-nav-toggle"));
    await expect(args.onToggleCollapsed).toHaveBeenCalled();
  },
};

/** Vertical arrow keys move focus and select (automatic activation). */
export const KeyboardNavigation: Story = {
  args: { contexts: MULTI_CONTEXTS, onSelectContext: fn() },
  play: async ({ canvas, args }) => {
    const tabs = canvas.getAllByRole("tab");
    tabs[0].focus();
    await expect(tabs[0]).toHaveFocus();

    // ArrowDown moves to and selects the next context.
    await userEvent.keyboard("{ArrowDown}");
    await expect(tabs[1]).toHaveFocus();
    await expect(args.onSelectContext).toHaveBeenCalledWith("pm-bot");

    // ArrowUp moves back.
    await userEvent.keyboard("{ArrowUp}");
    await expect(tabs[0]).toHaveFocus();

    // End jumps to last, Home back to first.
    await userEvent.keyboard("{End}");
    await expect(tabs[tabs.length - 1]).toHaveFocus();
    await userEvent.keyboard("{Home}");
    await expect(tabs[0]).toHaveFocus();
  },
};

/** The rail exposes vertical tablist ARIA semantics. */
export const AriaAttributes: Story = {
  play: async ({ canvas }) => {
    const tablist = canvas.getByRole("tablist");
    await expect(tablist).toHaveAttribute("aria-orientation", "vertical");
    await expect(tablist).toHaveAttribute("aria-label", "Context navigation");
  },
};

/**
 * Fleet section (#1415): Coordination renders above the contexts, marked active
 * via `aria-current`, and selecting it fires `onSelectFleet` with its id. Fleet
 * items are plain buttons, not part of the context `tablist`.
 */
export const WithFleet: Story = {
  args: { fleetItems: FLEET_ITEMS, activeFleetId: "coordination", onSelectFleet: fn() },
  play: async ({ canvas, args }) => {
    const coordination = canvas.getByTestId("sidebar-tab-coordination");
    await expect(coordination).toBeInTheDocument();
    await expect(coordination).toHaveTextContent("Coordination");
    await expect(coordination).toHaveAttribute("aria-current", "page");
    // The fleet item is a button, not a tab — the only tablist is the contexts.
    await expect(coordination).not.toHaveAttribute("role", "tab");

    await userEvent.click(coordination);
    await expect(args.onSelectFleet).toHaveBeenCalledWith("coordination");
  },
};

/** Collapsed: the fleet item is icon-only (label moves into a tooltip). */
export const WithFleetCollapsed: Story = {
  args: {
    fleetItems: FLEET_ITEMS,
    activeFleetId: "coordination",
    onSelectFleet: fn(),
    collapsed: true,
    onToggleCollapsed: fn(),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("context-nav")).toHaveAttribute("data-collapsed", "true");
    // Label is not rendered inline when collapsed.
    await expect(canvas.getByTestId("sidebar-tab-coordination")).not.toHaveTextContent(
      "Coordination",
    );
  },
};
