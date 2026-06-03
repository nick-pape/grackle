import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor } from "@storybook/test";
import { EventStream } from "./EventStream.js";
import type { DisplayEvent } from "../../utils/sessionEvents.js";
import { makeEvent, makeSession, makeEnvironment } from "../../test-utils/storybook-helpers.js";

const sampleEvents: DisplayEvent[] = [
  // User messages render as markdown, same as agent output.
  makeEvent({
    eventType: "user_input",
    content:
      "Can you check **`auth.ts`**? The `refreshToken` flow looks broken:\n\n1. token isn't refreshed before expiry\n2. the retry has an off-by-one",
    timestamp: "2026-01-01T00:00:00Z",
  }),
  makeEvent({ eventType: "text", content: "First message", timestamp: "2026-01-01T00:00:01Z" }),
  makeEvent({ eventType: "text", content: "Second message", timestamp: "2026-01-01T00:00:02Z" }),
  makeEvent({ eventType: "text", content: "Third message", timestamp: "2026-01-01T00:00:03Z" }),
];

/** A richer set of events including non-content types for selection mode tests. */
const mixedEvents: DisplayEvent[] = [
  makeEvent({
    eventType: "user_input",
    content:
      "Fix the **login bug** in `auth.ts`:\n\n- token isn't refreshed\n- expiry check is off-by-one",
    timestamp: "2026-01-01T00:00:01Z",
  }),
  makeEvent({ eventType: "text", content: "Looking into it.", timestamp: "2026-01-01T00:00:02Z" }),
  makeEvent({ eventType: "status", content: "running", timestamp: "2026-01-01T00:00:03Z" }),
  makeEvent({
    eventType: "text",
    content: "Found the issue in auth.ts",
    timestamp: "2026-01-01T00:00:04Z",
  }),
  makeEvent({ eventType: "error", content: "Test failed", timestamp: "2026-01-01T00:00:05Z" }),
];

const meta: Meta<typeof EventStream> = {
  component: EventStream,
  title: "Grackle/Display/EventStream",
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div
        style={{ height: "400px", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <Story />
      </div>
    ),
  ],
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
    // Wait for Virtuoso to render all items before asserting counts
    await waitFor(async () => {
      await expect(canvas.getAllByTestId("event-hover-row").length).toBe(sampleEvents.length);
    });
    await expect(canvas.getAllByTestId("event-hover-copy").length).toBe(sampleEvents.length);
    await expect(canvas.getAllByTestId("event-hover-select").length).toBe(sampleEvents.length);
  },
};

/** Non-content events (status) do not get hover actions. */
export const NonContentNoHover: Story = {
  args: {
    events: mixedEvents,
  },
  play: async ({ canvas }) => {
    // Wait for Virtuoso to render all 4 content-bearing rows (status is not content-bearing)
    await waitFor(async () => {
      const hoverRows = canvas.getAllByTestId("event-hover-row");
      await expect(hoverRows.length).toBe(4);
    });
  },
};

/** Clicking Select enters selection mode with floating action bar. */
export const SelectionMode: Story = {
  args: {
    events: mixedEvents,
  },
  play: async ({ canvas }) => {
    // Wait for all items to render before interacting
    await waitFor(async () => {
      const buttons = canvas.getAllByTestId("event-hover-select");
      await expect(buttons.length).toBe(4);
    });

    const selectButtons = canvas.getAllByTestId("event-hover-select");
    await userEvent.click(selectButtons[0]);

    // Floating action bar should appear
    const bar = await canvas.findByTestId("floating-action-bar");
    await expect(bar).toBeInTheDocument();

    // Count should show 1 selected
    const count = canvas.getByTestId("floating-bar-count");
    await expect(count).toHaveTextContent("1 selected");

    // Checkboxes should be visible
    await waitFor(async () => {
      const checkboxes = canvas.getAllByTestId("event-select-checkbox");
      await expect(checkboxes.length).toBe(4);
    });
  },
};

/** Select multiple events and verify count updates. */
export const MultiSelect: Story = {
  args: {
    events: mixedEvents,
  },
  play: async ({ canvas }) => {
    // Wait for all items
    await waitFor(async () => {
      const buttons = canvas.getAllByTestId("event-hover-select");
      await expect(buttons.length).toBe(4);
    });

    const selectButtons = canvas.getAllByTestId("event-hover-select");
    await userEvent.click(selectButtons[0]);

    // Wait for checkboxes
    await waitFor(async () => {
      const checkboxes = canvas.getAllByTestId("event-select-checkbox");
      await expect(checkboxes.length).toBe(4);
    });

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
    await waitFor(async () => {
      await expect(canvas.getAllByTestId("event-hover-select").length).toBe(4);
    });

    await userEvent.click(canvas.getAllByTestId("event-hover-select")[0]);

    const selectAllBtn = await canvas.findByTestId("floating-bar-select-all");
    await expect(selectAllBtn).toHaveTextContent("Select all");
    await userEvent.click(selectAllBtn);

    const count = canvas.getByTestId("floating-bar-count");
    await expect(count).toHaveTextContent("4 selected");
    await expect(selectAllBtn).toHaveTextContent("Deselect all");
  },
};

/** Forward button appears in floating bar when sessions + onForward are provided. */
export const ForwardButtonVisible: Story = {
  args: {
    events: mixedEvents,
    sessions: [
      makeSession({
        id: "sess-target",
        environmentId: "env-1",
        status: "running",
        prompt: "Another task",
      }),
    ],
    environments: [makeEnvironment({ id: "env-1", displayName: "Production" })],
    currentSessionId: "sess-current",
    onForward: fn(),
  },
  play: async ({ canvas }) => {
    await waitFor(async () => {
      await expect(canvas.getAllByTestId("event-hover-select").length).toBe(4);
    });
    await userEvent.click(canvas.getAllByTestId("event-hover-select")[0]);

    const forwardBtn = await canvas.findByTestId("floating-bar-forward");
    await expect(forwardBtn).toBeInTheDocument();
    await expect(forwardBtn).toBeEnabled();
  },
};

/** Forward button is disabled when no other active sessions exist. */
export const ForwardButtonDisabled: Story = {
  args: {
    events: mixedEvents,
    sessions: [],
    environments: [],
    currentSessionId: "sess-current",
    onForward: fn(),
  },
  play: async ({ canvas }) => {
    await waitFor(async () => {
      await expect(canvas.getAllByTestId("event-hover-select").length).toBe(4);
    });
    await userEvent.click(canvas.getAllByTestId("event-hover-select")[0]);

    const forwardBtn = await canvas.findByTestId("floating-bar-forward");
    await expect(forwardBtn).toHaveAttribute("aria-disabled", "true");
  },
};

/** Clicking Forward opens the session picker dialog. */
export const ForwardOpensSessionPicker: Story = {
  args: {
    events: mixedEvents,
    sessions: [
      makeSession({
        id: "sess-target",
        environmentId: "env-1",
        status: "idle",
        prompt: "Other task",
      }),
    ],
    environments: [makeEnvironment({ id: "env-1", displayName: "Dev" })],
    currentSessionId: "sess-current",
    onForward: fn(),
  },
  play: async ({ canvas }) => {
    await waitFor(async () => {
      await expect(canvas.getAllByTestId("event-hover-select").length).toBe(4);
    });
    await userEvent.click(canvas.getAllByTestId("event-hover-select")[0]);

    const forwardBtn = await canvas.findByTestId("floating-bar-forward");
    await userEvent.click(forwardBtn);

    const dialog = await canvas.findByTestId("session-picker-dialog");
    await expect(dialog).toBeInTheDocument();
    await expect(canvas.getByTestId("session-picker-item-sess-target")).toBeInTheDocument();
  },
};

/** Large event list to verify virtualization (only visible rows render). */
export const LargeEventList: Story = {
  args: {
    events: Array.from({ length: 500 }, (_, i) =>
      makeEvent({
        eventType: i % 5 === 0 ? "user_input" : "text",
        content: `Event ${i + 1}: ${i % 5 === 0 ? "User message" : "Agent response with some content to fill the row."}`,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      }),
    ),
  },
  play: async ({ canvas }) => {
    await waitFor(async () => {
      const rows = canvas.getAllByTestId("event-hover-row");
      await expect(rows.length).toBeGreaterThan(0);
      await expect(rows.length).toBeLessThan(50);
    });
  },
};

/** Cancel exits selection mode -- checkboxes disappear. */
export const CancelSelection: Story = {
  args: {
    events: mixedEvents,
  },
  play: async ({ canvas, canvasElement }) => {
    await waitFor(async () => {
      await expect(canvas.getAllByTestId("event-hover-select").length).toBe(4);
    });
    await userEvent.click(canvas.getAllByTestId("event-hover-select")[0]);

    await waitFor(async () => {
      await expect(canvas.getAllByTestId("event-select-checkbox").length).toBe(4);
    });

    const cancelBtn = canvas.getByTestId("floating-bar-cancel");
    await userEvent.click(cancelBtn);

    const checkboxesAfter = canvasElement.querySelectorAll("[data-testid='event-select-checkbox']");
    await expect(checkboxesAfter.length).toBe(0);

    await waitFor(async () => {
      await expect(canvas.getAllByTestId("event-hover-row").length).toBe(4);
    });
  },
};
