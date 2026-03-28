import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";
import { SplitButton } from "./SplitButton.js";

const meta: Meta<typeof SplitButton> = {
  component: SplitButton,
  title: "Primitives/Display/SplitButton",
  tags: ["autodocs"],
  args: {
    label: "Stop",
    onClick: fn(),
    options: [
      { label: "Stop", description: "Graceful shutdown", onClick: fn() },
      { label: "Kill", description: "Force kill", onClick: fn() },
    ],
    variant: "danger",
    size: "sm",
    "data-testid": "split-btn",
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default rendering — main label and chevron visible. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("split-btn-main")).toBeInTheDocument();
    await expect(canvas.getByTestId("split-btn-main")).toHaveTextContent("Stop");
    await expect(canvas.getByTestId("split-btn-chevron")).toBeInTheDocument();
    // Dropdown should NOT be visible
    await expect(canvas.queryByTestId("split-btn-menu")).not.toBeInTheDocument();
  },
};

/** Clicking the main area fires onClick without opening the dropdown. */
export const ClickMainAction: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("split-btn-main"));
    await expect(args.onClick).toHaveBeenCalledOnce();
    // Dropdown should remain closed
    await expect(canvas.queryByTestId("split-btn-menu")).not.toBeInTheDocument();
  },
};

/** Clicking the chevron opens the dropdown; selecting an option fires callback and closes it. */
export const OpenAndSelectOption: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Open the dropdown
    await userEvent.click(canvas.getByTestId("split-btn-chevron"));
    await expect(canvas.getByTestId("split-btn-menu")).toBeInTheDocument();

    // Both options visible in the menu
    const menu = within(canvas.getByTestId("split-btn-menu"));
    const options = menu.getAllByRole("button");
    await expect(options).toHaveLength(2);

    // Click the second option ("Kill")
    await userEvent.click(options[1]);
    await expect(args.options[1].onClick).toHaveBeenCalledOnce();

    // Dropdown should close
    await expect(canvas.queryByTestId("split-btn-menu")).not.toBeInTheDocument();
  },
};

/** Clicking outside the dropdown closes it. */
export const CloseOnClickOutside: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Open dropdown
    await userEvent.click(canvas.getByTestId("split-btn-chevron"));
    await expect(canvas.getByTestId("split-btn-menu")).toBeInTheDocument();

    // Click outside (the canvas root, outside the container)
    await userEvent.click(canvasElement);
    await expect(canvas.queryByTestId("split-btn-menu")).not.toBeInTheDocument();
  },
};

/** Danger variant with primary variant for comparison. */
export const PrimaryVariant: Story = {
  args: {
    label: "Deploy",
    variant: "primary",
    options: [
      { label: "Deploy", description: "Deploy to staging", onClick: fn() },
      { label: "Deploy prod", description: "Deploy to production", onClick: fn() },
    ],
  },
};
