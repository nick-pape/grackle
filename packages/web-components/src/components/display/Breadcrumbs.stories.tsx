import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { Breadcrumbs } from "./Breadcrumbs.js";

const meta: Meta<typeof Breadcrumbs> = {
  title: "Display/Breadcrumbs",
  component: Breadcrumbs,
  args: {
    segments: [
      { label: "Home", url: "/" },
      { label: "Workspaces", url: "/workspaces" },
      { label: "My Workspace", url: undefined },
    ],
  },
};

export default meta;

type Story = StoryObj<typeof Breadcrumbs>;

/** All breadcrumb segments render with correct labels. */
export const SegmentsRenderCorrectly: Story = {
  play: async ({ canvas }) => {
    const nav = canvas.getByTestId("breadcrumbs");
    await expect(nav).toBeInTheDocument();

    // All segment labels should be visible
    await expect(canvas.getByText("Home")).toBeInTheDocument();
    await expect(canvas.getByText("Workspaces")).toBeInTheDocument();
    await expect(canvas.getByText("My Workspace")).toBeInTheDocument();

    // Linked segments should be anchors
    const homeLink = canvas.getByRole("link", { name: "Home" });
    await expect(homeLink).toBeInTheDocument();
    await expect(homeLink).toHaveAttribute("href", "/");

    const workspacesLink = canvas.getByRole("link", { name: "Workspaces" });
    await expect(workspacesLink).toBeInTheDocument();
    await expect(workspacesLink).toHaveAttribute("href", "/workspaces");

    // The last segment (current page) should NOT be a link
    const currentSegment = canvas.getByText("My Workspace");
    await expect(currentSegment.tagName).not.toBe("A");
    await expect(currentSegment).toHaveAttribute("aria-current", "page");
  },
};

/** A single segment renders as the current page without separators. */
export const SingleSegment: Story = {
  args: {
    segments: [{ label: "Home", url: undefined }],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Home")).toBeInTheDocument();
    await expect(canvas.getByText("Home")).toHaveAttribute("aria-current", "page");

    // No separator should be rendered
    const separators = canvas.queryAllByText("\u203A");
    await expect(separators).toHaveLength(0);
  },
};

/** Multiple segments show separators between them. */
export const SeparatorsBetweenSegments: Story = {
  args: {
    segments: [
      { label: "Home", url: "/" },
      { label: "Settings", url: "/settings" },
      { label: "Credentials", url: undefined },
    ],
  },
  play: async ({ canvas }) => {
    // There should be separators between segments (n-1 separators for n segments)
    const separators = canvas.queryAllByText("\u203A");
    await expect(separators).toHaveLength(2);
  },
};
