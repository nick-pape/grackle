import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { EventRenderer } from "./EventRenderer.js";
import { makeEvent } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof EventRenderer> = {
  component: EventRenderer,
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Tool result with success indicator and label. */
export const ToolResultSuccess: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_result",
      content: "File written successfully",
      raw: JSON.stringify({ is_error: false }),
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-result-indicator-ok")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-result-label")).toHaveTextContent("Tool output");
  },
};

/** Short result (<=5 lines) has no expand toggle. */
export const ShortResultNoToggle: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_result",
      content: "Single line output",
    }),
  },
  play: async ({ canvas }) => {
    const result = canvas.getByTestId("tool-result");
    const toggle = within(result).queryByText("\u25b8");
    await expect(toggle).not.toBeInTheDocument();
  },
};

/** Multi-line result (>5 lines) shows toggle and expands/collapses. */
export const MultiLineExpandCollapse: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_result",
      content: Array.from({ length: 10 }, (_, i) => `Line ${i + 1} of output`).join("\n"),
    }),
  },
  play: async ({ canvas }) => {
    // Initially collapsed — line 6+ not visible
    await expect(canvas.queryByText("Line 6 of output")).not.toBeInTheDocument();

    // Click to expand
    const header = canvas.getByTestId("tool-result-header");
    await header.click();

    // Now line 6 should be visible
    await expect(canvas.getByText("Line 6 of output")).toBeInTheDocument();

    // Click to collapse
    await header.click();
    await expect(canvas.queryByText("Line 6 of output")).not.toBeInTheDocument();
  },
};

/** Error indicator shown when raw field has is_error=true. */
export const ToolResultError: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_result",
      content: "Command failed with exit code 1",
      raw: JSON.stringify({ is_error: true }),
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-result-indicator-error")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-result-label")).toHaveTextContent("Tool error");
  },
};

/** Success indicator when raw field has is_error=false. */
export const ToolResultExplicitSuccess: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_result",
      content: "OK",
      raw: JSON.stringify({ is_error: false }),
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-result-indicator-ok")).toBeInTheDocument();
  },
};

/** Success indicator when raw field is absent. */
export const ToolResultNoRaw: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_result",
      content: "Output without raw",
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-result-indicator-ok")).toBeInTheDocument();
  },
};

/** Paired tool_use+tool_result shows tool name and command preview. */
export const PairedToolUseResult: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_result",
      content: "File contents here",
    }),
    toolUseCtx: { tool: "Read", args: { file_path: "/src/index.ts" } },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-result-label")).toHaveTextContent("Read");
  },
};

/** System context event renders as collapsible prompt. */
export const SystemContext: Story = {
  args: {
    event: makeEvent({
      eventType: "system_context",
      content: "You are a helpful assistant.\nYou write clean code.\nYou follow best practices.\nLine 4.\nLine 5.\nLine 6.",
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("system-context-event")).toBeInTheDocument();
    await expect(canvas.getByText("SYSTEM PROMPT")).toBeInTheDocument();
  },
};
