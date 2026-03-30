import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { SessionAttemptSelector } from "./SessionAttemptSelector.js";
import type { Session } from "../../hooks/types.js";
import { makeSession } from "../../test-utils/storybook-helpers.js";

const stoppedCompleted: Session = makeSession({
  id: "sess-a",
  status: "stopped",
  endReason: "completed",
});

const running: Session = makeSession({
  id: "sess-b",
  status: "running",
});

const stoppedFailed: Session = makeSession({
  id: "sess-c",
  status: "stopped",
  endReason: "error",
});

const meta: Meta<typeof SessionAttemptSelector> = {
  title: "Primitives/Display/SessionAttemptSelector",
  component: SessionAttemptSelector,
  tags: ["autodocs"],
  args: {
    taskSessions: [stoppedCompleted, running],
    selectedSessionId: running.id,
    onSelect: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof SessionAttemptSelector>;

/** Component returns nothing when there is only one session. */
export const HiddenForSingleSession: Story = {
  args: {
    taskSessions: [running],
    selectedSessionId: running.id,
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId("attempt-selector")).toBeNull();
  },
};

/** Two attempts are rendered with correct labels. */
export const TwoAttempts: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("attempt-selector")).toBeInTheDocument();
    await expect(canvas.getByTestId("attempt-1")).toBeInTheDocument();
    await expect(canvas.getByTestId("attempt-2")).toBeInTheDocument();
  },
};

/** The selected attempt is highlighted via aria-pressed. */
export const ActiveAttemptHighlighted: Story = {
  args: {
    taskSessions: [stoppedCompleted, running, stoppedFailed],
    selectedSessionId: running.id,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("attempt-2")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByTestId("attempt-1")).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.getByTestId("attempt-3")).toHaveAttribute("aria-pressed", "false");
  },
};

/** Clicking an attempt fires the onSelect callback with the session id. */
export const ClickFiresOnSelect: Story = {
  play: async ({ canvas, args }) => {
    const btn = canvas.getByTestId("attempt-1");
    await userEvent.click(btn);
    await expect(args.onSelect).toHaveBeenCalledWith(stoppedCompleted.id);
  },
};
