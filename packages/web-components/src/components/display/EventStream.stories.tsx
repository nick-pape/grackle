import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { EventStream } from "./EventStream.js";
import type { DisplayEvent } from "../../utils/sessionEvents.js";
import { makeEvent } from "../../test-utils/storybook-helpers.js";

const sampleEvents: DisplayEvent[] = [
  makeEvent({ eventType: "text", content: "First message", timestamp: "2026-01-01T00:00:01Z" }),
  makeEvent({ eventType: "text", content: "Second message", timestamp: "2026-01-01T00:00:02Z" }),
  makeEvent({ eventType: "text", content: "Third message", timestamp: "2026-01-01T00:00:03Z" }),
];

/** A richer set of events including non-content types for selection mode tests. */
const mixedEvents: DisplayEvent[] = [
  makeEvent({ eventType: "user_input", content: "Fix the bug", timestamp: "2026-01-01T00:00:01Z" }),
  makeEvent({ eventType: "text", content: "Looking into it.", timestamp: "2026-01-01T00:00:02Z" }),
  makeEvent({ eventType: "status", content: "running", timestamp: "2026-01-01T00:00:03Z" }),
  makeEvent({ eventType: "text", content: "Found the issue in auth.ts", timestamp: "2026-01-01T00:00:04Z" }),
  makeEvent({ eventType: "error", content: "Test failed", timestamp: "2026-01-01T00:00:05Z" }),
];

const meta: Meta<typeof EventStream> = {
  component: EventStream,
  title: "Grackle/Display/EventStream",
  tags: ["autodocs"],
  args: {
    events: sampleEvents,
    eventsDropped: 0,
    onShowToast: fn(),
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

/** Hover over a content event to see action buttons. */
export const HoverActions: Story = {
  play: async ({ canvas }) => {
    // Hover actions should exist in the DOM (opacity controlled by CSS)
    const hoverRows = canvas.getAllByTestId("event-hover-row");
    await expect(hoverRows.length).toBeGreaterThan(0);

    // Each content event should have copy and select buttons
    const copyButtons = canvas.getAllByTestId("event-hover-copy");
    await expect(copyButtons.length).toBe(sampleEvents.length);

    const selectButtons = canvas.getAllByTestId("event-hover-select");
    await expect(selectButtons.length).toBe(sampleEvents.length);
  },
};

/** Non-content events (status) do not get hover actions. */
export const NonContentNoHover: Story = {
  args: {
    events: mixedEvents,
  },
  play: async ({ canvas }) => {
    // 4 content events out of 5 total (status is not content-bearing)
    const hoverRows = canvas.getAllByTestId("event-hover-row");
    await expect(hoverRows.length).toBe(4);
  },
};

/** Clicking Select enters selection mode with floating action bar. */
export const SelectionMode: Story = {
  args: {
    events: mixedEvents,
  },
  play: async ({ canvas }) => {
    // Click the Select button on the first event
    const selectButtons = canvas.getAllByTestId("event-hover-select");
    await userEvent.click(selectButtons[0]);

    // Floating action bar should appear
    const bar = canvas.getByTestId("floating-action-bar");
    await expect(bar).toBeInTheDocument();

    // Count should show 1 selected
    const count = canvas.getByTestId("floating-bar-count");
    await expect(count).toHaveTextContent("1 selected");

    // Checkboxes should be visible
    const checkboxes = canvas.getAllByTestId("event-select-checkbox");
    await expect(checkboxes.length).toBe(4); // 4 content-bearing events
  },
};

/** Select multiple events and verify count updates. */
export const MultiSelect: Story = {
  args: {
    events: mixedEvents,
  },
  play: async ({ canvas }) => {
    // Enter selection mode via first event
    const selectButtons = canvas.getAllByTestId("event-hover-select");
    await userEvent.click(selectButtons[0]);

    // Click second checkbox to select it too
    const checkboxes = canvas.getAllByTestId("event-select-checkbox");
    await userEvent.click(checkboxes[1]);

    // Count should show 2
    const count = canvas.getByTestId("floating-bar-count");
    await expect(count).toHaveTextContent("2 selected");
  },
};

/** Select All selects all content-bearing events. */
export const SelectAll: Story = {
  args: {
    events: mixedEvents,
  },
  play: async ({ canvas }) => {
    // Enter selection mode
    const selectButtons = canvas.getAllByTestId("event-hover-select");
    await userEvent.click(selectButtons[0]);

    // Click "Select all"
    const selectAllBtn = canvas.getByTestId("floating-bar-select-all");
    await expect(selectAllBtn).toHaveTextContent("Select all");
    await userEvent.click(selectAllBtn);

    // Count should show all content-bearing events (4 of 5)
    const count = canvas.getByTestId("floating-bar-count");
    await expect(count).toHaveTextContent("4 selected");

    // Button should now say "Deselect all"
    await expect(selectAllBtn).toHaveTextContent("Deselect all");
  },
};

/** Cancel exits selection mode. */
export const CancelSelection: Story = {
  args: {
    events: mixedEvents,
  },
  play: async ({ canvas, canvasElement }) => {
    // Enter selection mode
    const selectButtons = canvas.getAllByTestId("event-hover-select");
    await userEvent.click(selectButtons[0]);

    // Verify floating bar is present
    await expect(canvas.getByTestId("floating-action-bar")).toBeInTheDocument();

    // Click cancel
    const cancelBtn = canvas.getByTestId("floating-bar-cancel");
    await userEvent.click(cancelBtn);

    // Floating bar should be gone (may take a moment for animation)
    // Use canvasElement for null checks since queryByTestId is not on canvas
    const bar = canvasElement.querySelector("[data-testid='floating-action-bar']");
    await expect(bar).toBeFalsy();
  },
};
