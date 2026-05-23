import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import type { Session, StreamData } from "../../hooks/types.js";
import { CoordinationList } from "./CoordinationList.js";

function sub(sessionId: string): StreamData["subscribers"][number] {
  return { subscriptionId: `sub-${sessionId}`, sessionId, fd: 3, permission: "rw", deliveryMode: "async", createdBySpawn: false };
}
function stream(over: Partial<StreamData> & { id: string; name: string }): StreamData {
  return { subscriberCount: over.subscribers?.length ?? 1, messageBufferDepth: 0, selfEcho: false, subscribers: over.subscribers ?? [sub("s1")], ...over };
}
function session(id: string, taskId?: string): Session {
  return { id, environmentId: "env-1", runtime: "claude-code", status: "running", prompt: "", startedAt: "2026-01-01T00:00:00Z", taskId };
}

const sessions: Session[] = [session("s1", "task-1"), session("s2", "task-1"), session("s3")];
const tasks: { id: string; title: string }[] = [{ id: "task-1", title: "Implement JWT auth" }];

const mixedStreams: StreamData[] = [
  stream({ id: "room", name: "agent-chat", selfEcho: true, subscribers: [sub("s1"), sub("s2")], subscriberCount: 2 }),
  stream({ id: "chan", name: "telemetry", subscribers: [sub("s2")] }),
  stream({ id: "orphan", name: "cli-inspector", subscribers: [sub("s3")] }),
];

const meta: Meta<typeof CoordinationList> = {
  title: "Grackle/Streams/CoordinationList",
  component: CoordinationList,
  args: {
    streams: mixedStreams,
    sessions,
    tasks,
    loading: false,
    loadedOnce: true,
    showInternals: false,
    onToggleInternals: fn(),
    onSelectStream: fn(),
    onRefresh: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Streams grouped by owning task, with a trailing unattached/external bucket. */
export const GroupedByTask: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("coordination-list")).toBeInTheDocument();
    await expect(canvas.getByText("Implement JWT auth")).toBeInTheDocument();
    await expect(canvas.getByText(/Unattached/)).toBeInTheDocument();
    await expect(canvas.getByTestId("coordination-row-room")).toBeInTheDocument();
    await expect(canvas.getByTestId("coordination-row-orphan")).toBeInTheDocument();
  },
};

/** Each stream is tagged with its kind badge. */
export const KindBadges: Story = {
  play: async ({ canvas }) => {
    // mixedStreams has one chatroom and two channels.
    await expect(canvas.getAllByText("Chatroom")).toHaveLength(1);
    await expect(canvas.getAllByText("Channel")).toHaveLength(2);
  },
};

/** Toggling "Show internals" calls back to re-fetch. */
export const InternalsToggle: Story = {
  play: async ({ canvas, args }) => {
    const toggle = canvas.getByTestId("coordination-show-internals");
    await expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await expect(args.onToggleInternals).toHaveBeenCalledWith(true);
  },
};

/** Clicking a row selects the stream. */
export const SelectStream: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByTestId("coordination-row-chan"));
    await expect(args.onSelectStream).toHaveBeenCalledWith("chan");
  },
};

/** Empty state when there are no streams. */
export const EmptyState: Story = {
  args: { streams: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("coordination-empty")).toBeInTheDocument();
  },
};

/** Error state when the load failed. */
export const ErrorState: Story = {
  args: { streams: [], loadError: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("coordination-error")).toBeInTheDocument();
  },
};
