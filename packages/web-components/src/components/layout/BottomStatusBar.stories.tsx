import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { MemoryRouter } from "react-router";
import { BottomStatusBar } from "./BottomStatusBar.js";

const meta: Meta<typeof BottomStatusBar> = {
  component: BottomStatusBar,
  title: "Grackle/Layout/BottomStatusBar",
  tags: ["autodocs"],
  parameters: { skipRouter: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Empty state on the root route returns an empty fragment. */
export const EmptyState: Story = {
  args: {
    sessions: [],
    tasks: [],
    environments: [],
  },
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={["/"]}>
        <Story />
      </MemoryRouter>
    ),
  ],
  play: async ({ canvas }) => {
    // On the root "/" route with no data, the bar renders an empty fragment.
    // The container should exist but the bar itself should not render any visible hint.
    const bar = canvas.queryByText("Loading...");
    await expect(bar).not.toBeInTheDocument();
  },
};
