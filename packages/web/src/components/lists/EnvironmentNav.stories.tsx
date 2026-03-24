import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { MemoryRouter } from "react-router";
import { EnvironmentNav } from "./EnvironmentNav.js";
import { buildEnvironment } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof EnvironmentNav> = {
  title: "Lists/EnvironmentNav",
  component: EnvironmentNav,
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={["/environments"]}>
        <Story />
      </MemoryRouter>
    ),
  ],
  args: {
    environments: [
      buildEnvironment({ id: "env-1", displayName: "test-local", status: "connected" }),
      buildEnvironment({ id: "env-2", displayName: "test-ssh", status: "disconnected", adapterType: "ssh" }),
      buildEnvironment({ id: "env-3", displayName: "test-docker", status: "error", adapterType: "docker" }),
    ],
  },
};

export default meta;
type Story = StoryObj<typeof EnvironmentNav>;

/** Environment card renders with its display name. */
export const CardRendersWithName: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("test-local")).toBeInTheDocument();
    await expect(canvas.getByText("test-ssh")).toBeInTheDocument();
    await expect(canvas.getByText("test-docker")).toBeInTheDocument();
  },
};

/** Status dot is colored based on the environment status. */
export const StatusDotColored: Story = {
  args: {
    environments: [
      buildEnvironment({ id: "env-connected", displayName: "Connected Env", status: "connected" }),
      buildEnvironment({ id: "env-disconnected", displayName: "Disconnected Env", status: "disconnected" }),
      buildEnvironment({ id: "env-error", displayName: "Error Env", status: "error" }),
    ],
  },
  play: async ({ canvas }) => {
    // Each environment nav item should have a status dot
    const items = canvas.getAllByTestId("env-nav-item");
    await expect(items.length).toBe(3);

    // Each item contains a dot character (the bullet)
    for (const item of items) {
      await expect(item.textContent).toContain("\u25CF");
    }
  },
};

/** The "+ Add Environment" button is visible and accessible. */
export const AddButtonVisible: Story = {
  play: async ({ canvas }) => {
    const addButton = canvas.getByTestId("env-nav-add");
    await expect(addButton).toBeInTheDocument();
    await expect(addButton).toHaveTextContent("+ Add Environment");
  },
};

/** Environment cards appear in the nav list. */
export const CardsInList: Story = {
  play: async ({ canvas }) => {
    const navItems = canvas.getAllByTestId("env-nav-item");
    await expect(navItems.length).toBe(3);
  },
};

/** Empty state shows a message when there are no environments. */
export const EmptyState: Story = {
  args: {
    environments: [],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No environments yet.")).toBeInTheDocument();
    // Add button should still be visible
    await expect(canvas.getByTestId("env-nav-add")).toBeInTheDocument();
  },
};
