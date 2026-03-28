import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { Sidebar } from "./Sidebar.js";

const meta: Meta<typeof Sidebar> = {
  component: Sidebar,
  title: "Primitives/Layout/Sidebar",
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Sidebar renders its content slot. */
export const WithContent: Story = {
  args: {
    content: (
      <div data-testid="sidebar-child">
        <h3>Navigation</h3>
        <ul>
          <li>Home</li>
          <li>Tasks</li>
          <li>Settings</li>
        </ul>
      </div>
    ),
  },
  play: async ({ canvas }) => {
    const sidebar = canvas.getByTestId("sidebar");
    await expect(sidebar).toBeInTheDocument();
    const child = canvas.getByTestId("sidebar-child");
    await expect(child).toBeInTheDocument();
    await expect(canvas.getByText("Navigation")).toBeInTheDocument();
    await expect(canvas.getByText("Tasks")).toBeInTheDocument();
  },
};

/** Sidebar is hidden when content is undefined. */
export const Empty: Story = {
  args: {
    content: undefined,
  },
  play: async ({ canvas }) => {
    const sidebar = canvas.queryByTestId("sidebar");
    await expect(sidebar).not.toBeInTheDocument();
  },
};
