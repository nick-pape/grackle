import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { AppNav } from "./AppNav.js";

const meta: Meta<typeof AppNav> = {
  title: "Layout/AppNav",
  component: AppNav,
};
export default meta;
type Story = StoryObj<typeof meta>;

/** All six navigation tabs are rendered. */
export const AllTabsRendered: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /Dashboard/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Chat/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Tasks/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Environments/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Knowledge/ })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: /Settings/ })).toBeInTheDocument();
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

    // Home jumps to first
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
