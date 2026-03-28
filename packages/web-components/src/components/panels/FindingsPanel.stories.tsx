import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { FindingsPanel } from "./FindingsPanel.js";
import { buildFinding } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof FindingsPanel> = {
  title: "Grackle/Panels/FindingsPanel",
  component: FindingsPanel,
  tags: ["autodocs"],
  args: {
    findings: [],
  },
};

export default meta;
type Story = StoryObj<typeof FindingsPanel>;

/** Empty state shows a placeholder message when there are no findings. */
export const EmptyState: Story = {
  args: {
    findings: [],
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("No findings yet. Agents will post discoveries here."),
    ).toBeInTheDocument();
  },
};

/** Renders a single finding card with category badge, title, content, and tags. */
export const SingleFinding: Story = {
  args: {
    findings: [
      buildFinding({
        id: "f-1",
        category: "architecture",
        title: "Service boundary issue",
        content: "The auth service is tightly coupled to the user service.",
        tags: ["coupling", "refactor"],
      }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("architecture")).toBeInTheDocument();
    await expect(canvas.getByText("Service boundary issue")).toBeInTheDocument();
    await expect(canvas.getByText(/tightly coupled/)).toBeInTheDocument();
    await expect(canvas.getByText("coupling")).toBeInTheDocument();
    await expect(canvas.getByText("refactor")).toBeInTheDocument();
  },
};

/** Renders multiple findings across different categories. */
export const MultipleFindings: Story = {
  args: {
    findings: [
      buildFinding({
        id: "f-1",
        category: "bug",
        title: "Race condition in session cleanup",
        content: "When two sessions end simultaneously, the cleanup handler may skip one.",
        tags: ["concurrency"],
      }),
      buildFinding({
        id: "f-2",
        category: "api",
        title: "Missing pagination on list endpoints",
        content: "The list_tasks endpoint returns all tasks without pagination support.",
        tags: ["api", "performance"],
      }),
      buildFinding({
        id: "f-3",
        category: "decision",
        title: "Chose SQLite over PostgreSQL",
        content: "SQLite with WAL mode provides sufficient concurrency for single-server deployment.",
        tags: ["database"],
      }),
    ],
  },
  play: async ({ canvas }) => {
    // Use getAllByText for "api" since it appears as both a category badge and a tag
    await expect(canvas.getByText("bug")).toBeInTheDocument();
    const apiElements = canvas.getAllByText("api");
    await expect(apiElements.length).toBeGreaterThanOrEqual(1);
    await expect(canvas.getByText("decision")).toBeInTheDocument();
    await expect(canvas.getByText("Race condition in session cleanup")).toBeInTheDocument();
    await expect(canvas.getByText("Missing pagination on list endpoints")).toBeInTheDocument();
    await expect(canvas.getByText("Chose SQLite over PostgreSQL")).toBeInTheDocument();
  },
};

/** Long content is truncated at 300 characters with an ellipsis. */
export const LongContentTruncated: Story = {
  args: {
    findings: [
      buildFinding({
        id: "f-long",
        category: "pattern",
        title: "Verbose finding",
        content: "A".repeat(400),
        tags: [],
      }),
    ],
  },
  play: async ({ canvas }) => {
    // The rendered content should end with "..." since it exceeds 300 chars
    const contentEl = canvas.getByText(/A{10,}\.\.\.$/);
    await expect(contentEl).toBeInTheDocument();
  },
};
