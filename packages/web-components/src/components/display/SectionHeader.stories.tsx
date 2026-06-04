import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";
import { List, Plus, Filter } from "lucide-react";
import { ICON_MD } from "../../utils/iconSize.js";
import { SectionHeader } from "./SectionHeader.js";

const meta: Meta<typeof SectionHeader> = {
  component: SectionHeader,
  title: "Primitives/Display/SectionHeader",
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: 320, background: "var(--bg-surface)", padding: "var(--space-sm) 0" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Title only, no actions. */
export const Default: Story = {
  args: {
    title: "Tasks",
    "data-testid": "section-header",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Tasks")).toBeInTheDocument();
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
  },
};

/** Actions render and fire callbacks on click. */
export const WithActions: Story = {
  args: {
    title: "Environments",
    actions: [
      {
        key: "group",
        icon: <List size={ICON_MD} />,
        tooltip: "Group by status",
        ariaLabel: "Group by status",
        onClick: fn(),
        testId: "action-group",
      },
      {
        key: "add",
        icon: <Plus size={ICON_MD} />,
        tooltip: "New environment",
        ariaLabel: "New environment",
        onClick: fn(),
        testId: "action-add",
      },
    ],
    "data-testid": "section-header",
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Environments")).toBeInTheDocument();

    const groupBtn = canvas.getByTestId("action-group");
    await expect(groupBtn).toBeInTheDocument();
    await userEvent.click(groupBtn);
    await expect(args.actions![0].onClick).toHaveBeenCalledOnce();

    const addBtn = canvas.getByTestId("action-add");
    await userEvent.click(addBtn);
    await expect(args.actions![1].onClick).toHaveBeenCalledOnce();
  },
};

/** Active action renders with green accent color. */
export const ActiveAction: Story = {
  args: {
    title: "Schedules",
    actions: [
      {
        key: "filter",
        icon: <Filter size={ICON_MD} />,
        tooltip: "Filter active",
        ariaLabel: "Filter",
        onClick: fn(),
        active: true,
        ariaPressed: true,
        testId: "action-filter",
      },
    ],
    "data-testid": "section-header",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const filterBtn = canvas.getByTestId("action-filter");
    const color = window.getComputedStyle(filterBtn).color;
    await expect(color).not.toBe("rgba(0, 0, 0, 0)");
    await expect(filterBtn).toHaveAttribute("aria-pressed", "true");
  },
};

/** Empty actions array renders no action container. */
export const NoActions: Story = {
  args: {
    title: "Coordination",
    actions: [],
    "data-testid": "section-header",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Coordination")).toBeInTheDocument();
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
  },
};
