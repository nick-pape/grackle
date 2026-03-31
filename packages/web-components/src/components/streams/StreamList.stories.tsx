import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import type { StreamData } from "../../hooks/types.js";
import { withMockGrackleRoute } from "../../test-utils/storybook-helpers.js";
import { StreamList } from "./StreamList.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockStreams: StreamData[] = [
  {
    id: "stream-001",
    name: "agent-chat",
    subscriberCount: 2,
    messageBufferDepth: 0,
    subscribers: [],
  },
  {
    id: "stream-002",
    name: "coordinator-bus",
    subscriberCount: 1,
    messageBufferDepth: 3,
    subscribers: [],
  },
  {
    id: "stream-003",
    name: "telemetry-feed",
    subscriberCount: 0,
    messageBufferDepth: 0,
    subscribers: [],
  },
];

// ---------------------------------------------------------------------------
// Story meta
// ---------------------------------------------------------------------------

const meta: Meta<typeof StreamList> = {
  title: "Grackle/Streams/StreamList",
  component: StreamList,
  parameters: { skipRouter: true },
  args: {
    streams: mockStreams,
    loading: false,
    onRefresh: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof StreamList>;

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

/** Default: shows System pinned row and a list of named streams. */
export const Default: Story = {
  decorators: [withMockGrackleRoute(["/chat"], "/chat")],
};

/** Empty state: no named streams, only the System row. */
export const Empty: Story = {
  decorators: [withMockGrackleRoute(["/chat"], "/chat")],
  args: {
    streams: [],
  },
};

/** Loading state while streams are being fetched. */
export const Loading: Story = {
  decorators: [withMockGrackleRoute(["/chat"], "/chat")],
  args: {
    streams: [],
    loading: true,
  },
};

/** System row is visually selected when on the /chat route. */
export const SystemSelected: Story = {
  decorators: [withMockGrackleRoute(["/chat"], "/chat")],
  play: async ({ canvas }) => {
    const systemRow = canvas.getByTestId("stream-list-system-row");
    await expect(systemRow).toBeInTheDocument();
    await expect(systemRow).toHaveAttribute("aria-selected", "true");
  },
};

/** A named stream is selected when on its /chat/:streamId route. */
export const StreamSelected: Story = {
  decorators: [withMockGrackleRoute(["/chat/stream-001"], "/chat/:streamId")],
  play: async ({ canvas }) => {
    const streamRow = canvas.getByTestId("stream-list-row-stream-001");
    await expect(streamRow).toBeInTheDocument();
    await expect(streamRow).toHaveAttribute("aria-selected", "true");
    const systemRow = canvas.getByTestId("stream-list-system-row");
    await expect(systemRow).toHaveAttribute("aria-selected", "false");
  },
};
