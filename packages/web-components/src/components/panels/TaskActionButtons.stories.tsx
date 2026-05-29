import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { TaskActionButtons } from "./TaskActionButtons.js";
import { makeTask } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof TaskActionButtons> = {
  title: "App/Panels/TaskActionButtons",
  component: TaskActionButtons,
  tags: ["autodocs"],
  args: {
    task: makeTask({ id: "t-1", status: "not_started" }),
    sessionId: undefined,
    latestSessionStatus: undefined,
    isBlocked: false,
    onStart: fn(),
    onResume: fn(),
    onStop: fn(),
    onPause: fn(),
    onDelete: fn(),
    onEdit: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof TaskActionButtons>;

/** Not-started + unblocked shows Start, Edit, and Delete buttons. */
export const NotStartedUnblocked: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("task-header-start")).toBeInTheDocument();
    await expect(canvas.getByTestId("task-action-edit")).toBeInTheDocument();
    await expect(canvas.getByTestId("task-action-delete")).toBeInTheDocument();
  },
};

/** Not-started + blocked hides Start, shows Edit and Delete. */
export const NotStartedBlocked: Story = {
  args: {
    isBlocked: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId("task-header-start")).toBeNull();
    await expect(canvas.getByTestId("task-action-edit")).toBeInTheDocument();
    await expect(canvas.getByTestId("task-action-delete")).toBeInTheDocument();
  },
};

/** Working status shows Stop and Pause. */
export const Working: Story = {
  args: {
    task: makeTask({ id: "t-2", status: "working" }),
    sessionId: "sess-1",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("task-action-stop")).toBeInTheDocument();
    await expect(canvas.getByTestId("task-action-pause")).toBeInTheDocument();
    await expect(canvas.getByTestId("task-action-pause")).toBeEnabled();
  },
};

/** Working without a session disables the Pause button. */
export const WorkingNoSession: Story = {
  args: {
    task: makeTask({ id: "t-3", status: "working" }),
    sessionId: undefined,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("task-action-stop")).toBeInTheDocument();
    await expect(canvas.getByTestId("task-action-pause")).toBeDisabled();
  },
};

/** Paused with a stopped session shows Stop, Resume, and Delete. */
export const PausedStoppedSession: Story = {
  args: {
    task: makeTask({ id: "t-4", status: "paused" }),
    latestSessionStatus: "stopped",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("task-action-stop")).toBeInTheDocument();
    await expect(canvas.getByTestId("task-action-resume")).toBeInTheDocument();
    await expect(canvas.getByTestId("task-action-delete")).toBeInTheDocument();
  },
};

/**
 * Paused while the session is still alive and idle (awaiting input) hides
 * Resume: the session is not resumable, so the button would be a no-op.
 */
export const PausedIdleSession: Story = {
  args: {
    task: makeTask({ id: "t-4b", status: "paused" }),
    sessionId: "sess-idle",
    latestSessionStatus: "idle",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("task-action-stop")).toBeInTheDocument();
    await expect(canvas.queryByTestId("task-action-resume")).toBeNull();
    await expect(canvas.getByTestId("task-action-delete")).toBeInTheDocument();
  },
};

/** Complete status shows only Delete. */
export const Complete: Story = {
  args: {
    task: makeTask({ id: "t-5", status: "complete" }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("task-action-delete")).toBeInTheDocument();
    await expect(canvas.queryByTestId("task-header-start")).toBeNull();
    await expect(canvas.queryByTestId("task-action-stop")).toBeNull();
  },
};

/** Failed status shows Retry and Delete. */
export const Failed: Story = {
  args: {
    task: makeTask({ id: "t-6", status: "failed" }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("task-header-start")).toBeInTheDocument();
    await expect(canvas.getByTestId("task-action-delete")).toBeInTheDocument();
  },
};

/** Clicking Start fires the onStart callback. */
export const ClickStart: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByTestId("task-header-start"));
    await expect(args.onStart).toHaveBeenCalledOnce();
  },
};

/** Clicking Stop fires the onStop callback. */
export const ClickStop: Story = {
  args: {
    task: makeTask({ id: "t-7", status: "working" }),
    sessionId: "sess-1",
  },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByTestId("task-action-stop"));
    await expect(args.onStop).toHaveBeenCalledOnce();
  },
};
