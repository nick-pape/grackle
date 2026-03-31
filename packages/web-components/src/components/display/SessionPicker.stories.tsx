import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { SessionPicker } from "./SessionPicker.js";
import type { Environment, Session } from "../../hooks/types.js";
import { makeSession, makeEnvironment } from "../../test-utils/storybook-helpers.js";

const mockEnvironments: Environment[] = [
  makeEnvironment({ id: "env-1", displayName: "Production" }),
  makeEnvironment({ id: "env-2", displayName: "Staging" }),
  makeEnvironment({ id: "env-3", displayName: "Dev Box" }),
];

const mockSessions: Session[] = [
  makeSession({ id: "sess-1", environmentId: "env-1", status: "running", prompt: "Refactor the authentication module and update tests" }),
  makeSession({ id: "sess-2", environmentId: "env-2", status: "idle", prompt: "Fix the login redirect bug in the frontend" }),
  makeSession({ id: "sess-3", environmentId: "env-3", status: "running", prompt: "Add dark mode support to the settings page" }),
];

const meta: Meta<typeof SessionPicker> = {
  component: SessionPicker,
  title: "Grackle/Display/SessionPicker",
  tags: ["autodocs"],
  args: {
    isOpen: true,
    sessions: mockSessions,
    environments: mockEnvironments,
    onSelect: fn(),
    onCancel: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default state: multiple active sessions available. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const dialog = canvas.getByTestId("session-picker-dialog");
    await expect(dialog).toBeInTheDocument();

    const list = canvas.getByTestId("session-picker-list");
    await expect(list).toBeInTheDocument();

    // All three sessions should be listed
    await expect(canvas.getByTestId("session-picker-item-sess-1")).toBeInTheDocument();
    await expect(canvas.getByTestId("session-picker-item-sess-2")).toBeInTheDocument();
    await expect(canvas.getByTestId("session-picker-item-sess-3")).toBeInTheDocument();
  },
};

/** Status badges are rendered for each session. */
export const StatusBadges: Story = {
  play: async ({ canvas }) => {
    const runningBadge = canvas.getByTestId("session-picker-status-sess-1");
    await expect(runningBadge).toHaveTextContent("running");

    const idleBadge = canvas.getByTestId("session-picker-status-sess-2");
    await expect(idleBadge).toHaveTextContent("idle");
  },
};

/** Clicking a session row calls onSelect with the session ID. */
export const SelectSession: Story = {
  play: async ({ canvas, args }) => {
    const sessionRow = canvas.getByTestId("session-picker-item-sess-2");
    await userEvent.click(sessionRow);
    await expect(args.onSelect).toHaveBeenCalledWith("sess-2");
  },
};

/** Clicking the close button calls onCancel. */
export const CloseButton: Story = {
  play: async ({ canvas, args }) => {
    const closeBtn = canvas.getByTestId("session-picker-close");
    await userEvent.click(closeBtn);
    await expect(args.onCancel).toHaveBeenCalled();
  },
};

/** Empty session list shows a no-sessions message. */
export const NoSessions: Story = {
  args: {
    sessions: [],
  },
  play: async ({ canvas }) => {
    const noSessions = canvas.getByTestId("session-picker-no-sessions");
    await expect(noSessions).toBeInTheDocument();
  },
};

/** Filter input appears only when there are more than 4 sessions. */
export const FilterInput: Story = {
  args: {
    sessions: [
      makeSession({ id: "sess-a", environmentId: "env-1", status: "running", prompt: "Task alpha" }),
      makeSession({ id: "sess-b", environmentId: "env-1", status: "idle", prompt: "Task beta" }),
      makeSession({ id: "sess-c", environmentId: "env-2", status: "running", prompt: "Task gamma" }),
      makeSession({ id: "sess-d", environmentId: "env-2", status: "idle", prompt: "Task delta" }),
      makeSession({ id: "sess-e", environmentId: "env-3", status: "running", prompt: "Task epsilon" }),
    ],
  },
  play: async ({ canvas }) => {
    const filter = canvas.getByTestId("session-picker-filter");
    await expect(filter).toBeInTheDocument();

    // Type to filter by environment name
    await userEvent.type(filter, "Staging");

    // Only staging sessions should appear (sess-c and sess-d use env-2)
    await expect(canvas.getByTestId("session-picker-item-sess-c")).toBeInTheDocument();
    await expect(canvas.getByTestId("session-picker-item-sess-d")).toBeInTheDocument();
    // Production sessions should be hidden
    await expect(canvas.queryByTestId("session-picker-item-sess-a")).not.toBeInTheDocument();
  },
};

/** Filter by prompt text. */
export const FilterByPrompt: Story = {
  args: {
    sessions: [
      makeSession({ id: "sess-a", environmentId: "env-1", status: "running", prompt: "Fix authentication bug" }),
      makeSession({ id: "sess-b", environmentId: "env-1", status: "idle", prompt: "Add dark mode" }),
      makeSession({ id: "sess-c", environmentId: "env-2", status: "running", prompt: "Fix database migration" }),
      makeSession({ id: "sess-d", environmentId: "env-2", status: "idle", prompt: "Update dependencies" }),
      makeSession({ id: "sess-e", environmentId: "env-3", status: "running", prompt: "Fix CSS layout" }),
    ],
  },
  play: async ({ canvas }) => {
    const filter = canvas.getByTestId("session-picker-filter");
    await userEvent.type(filter, "Fix");

    // Only "Fix" sessions should appear
    await expect(canvas.getByTestId("session-picker-item-sess-a")).toBeInTheDocument();
    await expect(canvas.getByTestId("session-picker-item-sess-c")).toBeInTheDocument();
    await expect(canvas.getByTestId("session-picker-item-sess-e")).toBeInTheDocument();
    // Non-fix sessions hidden
    await expect(canvas.queryByTestId("session-picker-item-sess-b")).not.toBeInTheDocument();
  },
};

/** No match shows empty state message. */
export const FilterNoMatch: Story = {
  args: {
    sessions: [
      makeSession({ id: "sess-a", environmentId: "env-1", status: "running", prompt: "Task alpha" }),
      makeSession({ id: "sess-b", environmentId: "env-1", status: "idle", prompt: "Task beta" }),
      makeSession({ id: "sess-c", environmentId: "env-2", status: "running", prompt: "Task gamma" }),
      makeSession({ id: "sess-d", environmentId: "env-2", status: "idle", prompt: "Task delta" }),
      makeSession({ id: "sess-e", environmentId: "env-3", status: "running", prompt: "Task epsilon" }),
    ],
  },
  play: async ({ canvas }) => {
    const filter = canvas.getByTestId("session-picker-filter");
    await userEvent.type(filter, "xyzzy-no-match");

    const empty = canvas.getByTestId("session-picker-empty");
    await expect(empty).toBeInTheDocument();
  },
};

/** Picker is hidden when isOpen is false. */
export const Closed: Story = {
  args: {
    isOpen: false,
  },
  play: async ({ canvas }) => {
    const overlay = canvas.queryByTestId("session-picker-overlay");
    await expect(overlay).not.toBeInTheDocument();
  },
};
