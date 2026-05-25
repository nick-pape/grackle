import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { ReactFlowProvider } from "@xyflow/react";
import { CoordinationGraph } from "./CoordinationGraph.js";
import { MOCK_STREAMS, MOCK_STREAM_MESSAGES } from "../../mocks/mockStreamsData.js";
import { MOCK_SESSIONS } from "../../mocks/mockData.js";

/**
 * CoordinationGraph uses @xyflow/react, which requires a parent
 * ReactFlowProvider and a container with explicit dimensions. Node positions
 * are not reliably computed in the headless runner, so the play functions
 * assert on the stable container/empty test ids only; the bipartite/pipe/edge
 * logic is verified in coordinationGraphModel.test.ts.
 */
const meta: Meta<typeof CoordinationGraph> = {
  title: "Grackle/Streams/CoordinationGraph",
  tags: ["autodocs"],
  component: CoordinationGraph,
  decorators: [
    (Story) => (
      <ReactFlowProvider>
        <div
          style={{
            width: "800px",
            height: "600px",
            "--text-primary": "#e6e6e6",
            "--text-secondary": "#b0b8c4",
            "--text-tertiary": "#6b7a8d",
            "--text-disabled": "#444",
            "--accent-green": "#22c55e",
            "--accent-yellow": "#eab308",
            "--accent-red": "#ef4444",
            "--accent-blue": "#3b82f6",
            "--bg-elevated": "#252535",
            "--bg-inset": "#1e1e2e",
            "--bg-overlay": "rgba(0,0,0,0.4)",
            "--border-subtle": "#33384a",
          } as CSSProperties}
        >
          <Story />
        </div>
      </ReactFlowProvider>
    ),
  ],
  args: {
    streams: [],
    sessions: MOCK_SESSIONS,
    onSelectStream: fn(),
    resolvedThemeId: "grackle-dark",
  },
};

export default meta;

type Story = StoryObj<typeof CoordinationGraph>;

/** Pick mock streams by id, preserving their declared order. */
function pick(ids: string[]): typeof MOCK_STREAMS {
  return MOCK_STREAMS.filter((s) => ids.includes(s.id));
}

/** With no streams, the graph shows an empty placeholder. */
export const EmptyState: Story = {
  name: "Empty state",
  args: { streams: [] },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("coordination-graph-empty")).toBeInTheDocument();
  },
};

/** A self-echo chatroom renders as a hub with its participant sessions. */
export const ChatroomHub: Story = {
  name: "Chatroom hub",
  args: { streams: pick(["stream-planning"]) },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("coordination-graph")).toBeInTheDocument();
  },
};

/** A non-self-echo named stream renders as a channel hub. */
export const ChannelHub: Story = {
  name: "Channel hub",
  args: { streams: pick(["stream-metrics"]) },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("coordination-graph")).toBeInTheDocument();
  },
};

/** A two-party pipe collapses into a direct session-to-session edge (no hub). */
export const PipeCollapsed: Story = {
  name: "Pipe (collapsed)",
  args: { streams: pick(["stream-pipe"]) },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("coordination-graph")).toBeInTheDocument();
  },
};

/** A stream whose subscriber session is unknown (CLI/MCP) renders an external node. */
export const OrphanExternal: Story = {
  name: "Orphan / external",
  args: { streams: pick(["stream-cli"]) },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("coordination-graph")).toBeInTheDocument();
  },
};

/** The full topology including internal plumbing (lifecycle/pipe/stdin). */
export const FullTopology: Story = {
  name: "Full topology (internals shown)",
  args: { streams: MOCK_STREAMS },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("coordination-graph")).toBeInTheDocument();
  },
};

/**
 * A stream with recent messages animates a dot along its edges. The dot element
 * is present whenever a stream's latest seq is stamped on its edges; we assert
 * presence (not animation timing) for determinism.
 */
export const MessageInFlight: Story = {
  name: "Message in flight",
  args: {
    streams: pick(["stream-planning"]),
    recentMessages: MOCK_STREAM_MESSAGES,
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("coordination-graph")).toBeInTheDocument();
    const dots = await canvas.findAllByTestId("coordination-message-dot");
    await expect(dots.length).toBeGreaterThanOrEqual(1);
  },
};
