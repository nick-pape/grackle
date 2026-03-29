import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { EventHoverRow } from "./EventHoverRow.js";

const meta: Meta<typeof EventHoverRow> = {
  component: EventHoverRow,
  title: "Grackle/Display/EventHoverRow",
  tags: ["autodocs"],
  args: {
    copyText: "Sample event content for clipboard",
    isContentBearing: true,
    isSelecting: false,
    isSelected: false,
    onSelect: fn(),
    onToggle: fn(),
    onCopied: fn(),
    children: (
      <div style={{ padding: "8px", background: "var(--bg-secondary)", borderRadius: 4 }}>
        Sample event content for clipboard
      </div>
    ),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default state - hover to see action buttons. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const row = canvas.getByTestId("event-hover-row");
    await expect(row).toBeInTheDocument();
    // Hover actions exist in DOM (opacity controlled by CSS)
    const actions = canvas.getByTestId("event-hover-actions");
    await expect(actions).toBeInTheDocument();
  },
};

/** Hover shows Copy and Select buttons. */
export const HoverActions: Story = {
  play: async ({ canvas }) => {
    const copyBtn = canvas.getByTestId("event-hover-copy");
    await expect(copyBtn).toBeInTheDocument();
    await expect(copyBtn).toHaveAccessibleName("Copy event content");

    const selectBtn = canvas.getByTestId("event-hover-select");
    await expect(selectBtn).toBeInTheDocument();
    await expect(selectBtn).toHaveAccessibleName("Select this event");
  },
};

/** Selection mode with event NOT selected - shows unchecked checkbox. */
export const SelectionModeUnselected: Story = {
  args: {
    isSelecting: true,
    isSelected: false,
  },
  play: async ({ canvas }) => {
    const row = canvas.getByTestId("event-selectable-row");
    await expect(row).toBeInTheDocument();
    await expect(row).toHaveAttribute("aria-selected", "false");

    const checkbox = canvas.getByTestId("event-select-checkbox");
    await expect(checkbox).toBeInTheDocument();
    await expect(checkbox).not.toBeChecked();
  },
};

/** Selection mode with event selected - shows checked checkbox + highlight. */
export const SelectionModeSelected: Story = {
  args: {
    isSelecting: true,
    isSelected: true,
  },
  play: async ({ canvas }) => {
    const row = canvas.getByTestId("event-selectable-row");
    await expect(row).toHaveAttribute("aria-selected", "true");

    const checkbox = canvas.getByTestId("event-select-checkbox");
    await expect(checkbox).toBeChecked();
  },
};

/** Non-content-bearing event - no hover actions or checkbox. */
export const NonContentBearing: Story = {
  args: {
    isContentBearing: false,
    children: (
      <div style={{ padding: "4px", color: "gray", fontSize: "12px" }}>
        --- status: running ---
      </div>
    ),
  },
  play: async ({ canvasElement }) => {
    // No hover actions or checkbox should exist
    const actions = canvasElement.querySelector("[data-testid='event-hover-actions']");
    await expect(actions).toBeFalsy();
    const checkbox = canvasElement.querySelector("[data-testid='event-select-checkbox']");
    await expect(checkbox).toBeFalsy();
  },
};
