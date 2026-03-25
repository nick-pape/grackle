import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { withMockGrackleRoute } from "../test-utils/storybook-helpers.js";
import { TaskPage } from "./TaskPage.js";

const meta: Meta<typeof TaskPage> = {
  component: TaskPage,
  parameters: { skipRouter: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Overview tab renders for a task with status "working". */
export const WorkingTaskOverview: Story = {
  decorators: [withMockGrackleRoute(["/tasks/task-001"], "/tasks/:taskId")],
  play: async ({ canvas }) => {
    // Task title should be visible
    await expect(canvas.getByTestId("task-title")).toBeInTheDocument();
    // Task status badge should be visible
    await expect(canvas.getByTestId("task-status")).toBeInTheDocument();
    // Tab bar should have Overview, Stream, Findings tabs
    await expect(canvas.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: "Stream" })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: "Findings" })).toBeInTheDocument();
  },
};

/** Stream tab is active when the URL ends with /stream. */
export const TaskWithStream: Story = {
  decorators: [withMockGrackleRoute(["/tasks/task-001/stream"], "/tasks/:taskId/stream")],
  play: async ({ canvas }) => {
    // Task title should be visible
    await expect(canvas.getByTestId("task-title")).toBeInTheDocument();
    // Stream tab should be selected
    const streamTab = canvas.getByRole("tab", { name: "Stream" });
    await expect(streamTab).toHaveAttribute("aria-selected", "true");
  },
};

/** Not-started task shows Start button and Overview tab. */
export const NotStartedTask: Story = {
  decorators: [withMockGrackleRoute(["/tasks/task-001c"], "/tasks/:taskId")],
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("task-title")).toBeInTheDocument();
    // Overview tab should be selected by default for not_started tasks
    const overviewTab = canvas.getByRole("tab", { name: "Overview" });
    await expect(overviewTab).toHaveAttribute("aria-selected", "true");
  },
};

/** Pressing 1/2/3 switches between tabs via keyboard shortcuts. */
export const KeyboardTabSwitching: Story = {
  decorators: [withMockGrackleRoute(["/tasks/task-001"], "/tasks/:taskId")],
  play: async ({ canvas }) => {
    // Overview tab should be selected initially
    const overviewTab = canvas.getByRole("tab", { name: "Overview" });
    await expect(overviewTab).toHaveAttribute("aria-selected", "true");

    // Press 2 to switch to Stream tab
    await userEvent.keyboard("2");
    const streamTab = canvas.getByRole("tab", { name: "Stream" });
    await expect(streamTab).toHaveAttribute("aria-selected", "true");

    // Press 3 to switch to Findings tab
    await userEvent.keyboard("3");
    const findingsTab = canvas.getByRole("tab", { name: "Findings" });
    await expect(findingsTab).toHaveAttribute("aria-selected", "true");

    // Press 1 to switch back to Overview
    await userEvent.keyboard("1");
    await expect(overviewTab).toHaveAttribute("aria-selected", "true");
  },
};

/** Blocked task on Stream tab hides Start CTA and shows blocked message. */
export const BlockedTaskStreamHidesStart: Story = {
  decorators: [withMockGrackleRoute(["/tasks/task-001c/stream"], "/tasks/:taskId/stream")],
  play: async ({ canvas }) => {
    // Stream tab should be selected
    const streamTab = canvas.getByRole("tab", { name: "Stream" });
    await expect(streamTab).toHaveAttribute("aria-selected", "true");
    // Start CTA should NOT be present (task is blocked by task-001b which is "working")
    await expect(canvas.queryByTestId("stream-start-cta")).toBeNull();
    // Blocked message should be visible instead
    await expect(canvas.getByTestId("stream-blocked-message")).toBeInTheDocument();
  },
};
