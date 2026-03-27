import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { EventStream } from "./EventStream.js";
import type { DisplayEvent } from "../../utils/sessionEvents.js";
import { makeEvent } from "../../test-utils/storybook-helpers.js";

const sampleEvents: DisplayEvent[] = [
  makeEvent({ eventType: "text", content: "First message", timestamp: "2026-01-01T00:00:01Z" }),
  makeEvent({ eventType: "text", content: "Second message", timestamp: "2026-01-01T00:00:02Z" }),
  makeEvent({ eventType: "text", content: "Third message", timestamp: "2026-01-01T00:00:03Z" }),
];

const meta: Meta<typeof EventStream> = {
  component: EventStream,
  args: {
    events: sampleEvents,
    eventsDropped: 0,
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default stream with events in chronological order. */
export const Default: Story = {};

/** Direction toggle button is present. */
export const DirectionToggle: Story = {
  play: async ({ canvas }) => {
    const toggle = canvas.getByTestId("direction-toggle");
    await expect(toggle).toBeInTheDocument();
  },
};

/** Empty state renders when no events. */
export const EmptyState: Story = {
  args: {
    events: [],
    emptyState: <div data-testid="custom-empty">No events yet</div>,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("custom-empty")).toBeInTheDocument();
  },
};
