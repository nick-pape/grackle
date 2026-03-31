import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";
import { ScheduleManager } from "./ScheduleManager.js";
import { makeSchedule, makePersona } from "../../test-utils/storybook-helpers.js";

const MOCK_PERSONAS: ReturnType<typeof makePersona>[] = [
  makePersona({ id: "persona-1", name: "Nightly Reviewer" }),
  makePersona({ id: "persona-2", name: "CI Monitor" }),
];

const meta: Meta<typeof ScheduleManager> = {
  title: "Grackle/Schedules/ScheduleManager",
  tags: ["autodocs"],
  component: ScheduleManager,
  args: {
    schedules: [],
    personas: MOCK_PERSONAS,
    onDeleteSchedule: fn().mockResolvedValue(undefined),
    onToggleEnabled: fn().mockResolvedValue(undefined),
    onNavigateToNew: fn(),
    onNavigateToSchedule: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ScheduleManager>;

export const Empty: Story = {
  args: { schedules: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("schedule-empty-state")).toBeInTheDocument();
  },
};

export const WithSchedules: Story = {
  args: {
    schedules: [
      makeSchedule({ id: "s1", title: "Nightly Review", scheduleExpression: "0 21 * * *", personaId: "persona-1", enabled: true, runCount: 42, lastRunAt: new Date(Date.now() - 3600_000).toISOString() }),
      makeSchedule({ id: "s2", title: "CI Monitor", scheduleExpression: "5m", personaId: "persona-2", enabled: true, runCount: 8, lastRunAt: new Date(Date.now() - 300_000).toISOString() }),
      makeSchedule({ id: "s3", title: "Stale PR Cleanup", scheduleExpression: "1d", personaId: "persona-1", enabled: false, runCount: 0, lastRunAt: "" }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("schedule-card-s1")).toBeInTheDocument();
    await expect(canvas.getByTestId("schedule-card-s2")).toBeInTheDocument();
    await expect(canvas.getByTestId("schedule-card-s3")).toBeInTheDocument();
    await expect(canvas.getByTestId("schedule-status-badge-s1")).toHaveTextContent("Enabled");
    await expect(canvas.getByTestId("schedule-status-badge-s3")).toHaveTextContent("Disabled");
    await expect(canvas.getByTestId("schedule-expression-s2")).toHaveTextContent("5m");
    await expect(canvas.getByTestId("schedule-run-count-s1")).toHaveTextContent("42");
  },
};

export const DeleteConfirmation: Story = {
  args: {
    schedules: [makeSchedule({ id: "del-1", title: "Delete Me" })],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("schedule-delete-del-1"));
    const dialog = document.querySelector('[role="dialog"]');
    await expect(dialog).toBeInTheDocument();
  },
};

export const ToggleEnabled: Story = {
  args: {
    schedules: [makeSchedule({ id: "tog-1", title: "Togglable", enabled: true })],
    onToggleEnabled: fn().mockResolvedValue({}),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("schedule-toggle-tog-1"));
    await expect(args.onToggleEnabled).toHaveBeenCalledWith("tog-1", { enabled: false });
  },
};
