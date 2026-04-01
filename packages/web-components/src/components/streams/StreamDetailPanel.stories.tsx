import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import type { StreamData } from "../../hooks/types.js";
import { withMockGrackleRoute } from "../../test-utils/storybook-helpers.js";
import { StreamDetailPanel } from "./StreamDetailPanel.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const streamWithSubscribers: StreamData = {
  id: "stream-abc123",
  name: "agent-chat",
  subscriberCount: 2,
  messageBufferDepth: 5,
  subscribers: [
    {
      subscriptionId: "sub-001",
      sessionId: "session-aabbccdd-eeff-0011",
      fd: 3,
      permission: "rw",
      deliveryMode: "async",
      createdBySpawn: true,
    },
    {
      subscriptionId: "sub-002",
      sessionId: "session-11223344-5566-7788",
      fd: 4,
      permission: "r",
      deliveryMode: "sync",
      createdBySpawn: false,
    },
  ],
};

const streamNoSubscribers: StreamData = {
  id: "stream-empty",
  name: "telemetry-feed",
  subscriberCount: 0,
  messageBufferDepth: 0,
  subscribers: [],
};

const streamAllModes: StreamData = {
  id: "stream-modes",
  name: "mixed-modes",
  subscriberCount: 3,
  messageBufferDepth: 0,
  subscribers: [
    {
      subscriptionId: "sub-rw-async",
      sessionId: "session-rw-async",
      fd: 3,
      permission: "rw",
      deliveryMode: "async",
      createdBySpawn: true,
    },
    {
      subscriptionId: "sub-r-sync",
      sessionId: "session-r-sync",
      fd: 4,
      permission: "r",
      deliveryMode: "sync",
      createdBySpawn: false,
    },
    {
      subscriptionId: "sub-w-detach",
      sessionId: "session-w-detach",
      fd: 5,
      permission: "w",
      deliveryMode: "detach",
      createdBySpawn: false,
    },
  ],
};

// ---------------------------------------------------------------------------
// Story meta
// ---------------------------------------------------------------------------

const meta: Meta<typeof StreamDetailPanel> = {
  title: "Grackle/Streams/StreamDetailPanel",
  component: StreamDetailPanel,
  decorators: [withMockGrackleRoute(["/chat/stream-abc123"], "/chat/:streamId")],
  parameters: { skipRouter: true },
  args: {
    stream: streamWithSubscribers,
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof StreamDetailPanel>;

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

/** Stream with multiple active subscribers. */
export const WithSubscribers: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("stream-detail-panel")).toBeInTheDocument();
    await expect(canvas.getByTestId("subscriber-card-sub-001")).toBeInTheDocument();
    await expect(canvas.getByTestId("subscriber-card-sub-002")).toBeInTheDocument();
  },
};

/** Stream with no subscribers. */
export const NoSubscribers: Story = {
  args: {
    stream: streamNoSubscribers,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No active subscribers")).toBeInTheDocument();
  },
};

/** All permission and delivery mode badge variants. */
export const AllPermissionModes: Story = {
  args: {
    stream: streamAllModes,
  },
};

/** Close button calls onClose. */
export const CloseButton: Story = {
  play: async ({ canvas, args }) => {
    const closeBtn = canvas.getByRole("button", { name: /close stream details/i });
    closeBtn.click();
    await expect(args.onClose).toHaveBeenCalled();
  },
};
