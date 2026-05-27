import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import type { StreamMessageData } from "../../hooks/types.js";
import { StreamTranscript } from "./StreamTranscript.js";

const messages: StreamMessageData[] = [
  {
    streamId: "s1",
    seq: "01A",
    senderId: "session-aabbccdd-eeff",
    content: "Proposing JWT with RS256.",
    timestamp: "2026-05-24T18:00:01.000Z",
  },
  {
    streamId: "s1",
    seq: "01B",
    senderId: "session-11223344-5566",
    content: "Agreed; rotate refresh tokens on use.",
    timestamp: "2026-05-24T18:00:07.000Z",
  },
  {
    streamId: "s1",
    seq: "01C",
    senderId: "session-aabbccdd-eeff",
    content: "Ship it.",
    timestamp: "2026-05-24T18:00:14.000Z",
  },
];

const meta: Meta<typeof StreamTranscript> = {
  title: "Grackle/Streams/StreamTranscript",
  component: StreamTranscript,
  args: { messages },
};

export default meta;
type Story = StoryObj<typeof StreamTranscript>;

/** Populated transcript renders one row per message. */
export const Populated: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByTestId("stream-transcript-message")).toHaveLength(3);
  },
};

/** Empty transcript shows the empty state. */
export const Empty: Story = {
  args: { messages: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("stream-transcript-empty")).toBeInTheDocument();
  },
};

/** Loading state while scrollback is being fetched. */
export const Loading: Story = {
  args: { messages: [], loading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("stream-transcript-loading")).toBeInTheDocument();
  },
};
