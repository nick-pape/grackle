import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
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
    await expect(canvas.queryByText(/Line 6 of output/)).not.toBeInTheDocument();

    // Click to expand
    const header = canvas.getByTestId("tool-result-header");
    await userEvent.click(header);

    // Now line 6 should be visible (use regex since text is inside a <pre>)
    await expect(canvas.getByText(/Line 6 of output/)).toBeInTheDocument();

    // Click to collapse
    await userEvent.click(header);
    await expect(canvas.queryByText(/Line 6 of output/)).not.toBeInTheDocument();
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

// --- Markdown rendering stories ---

/** Text event renders headings as h1/h2/h3 elements. */
export const MarkdownHeadings: Story = {
  args: {
    event: makeEvent({
      eventType: "text",
      content: "# Heading One\n\n## Heading Two\n\n### Heading Three",
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent("Heading One");
    await expect(canvas.getByRole("heading", { level: 2 })).toHaveTextContent("Heading Two");
    await expect(canvas.getByRole("heading", { level: 3 })).toHaveTextContent("Heading Three");
  },
};

/** Text event renders bold, italic, and links. */
export const MarkdownInlineFormatting: Story = {
  args: {
    event: makeEvent({
      eventType: "text",
      content: "This has **bold text** and *italic text* and [a link](https://example.com)",
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("bold text").tagName).toBe("STRONG");
    await expect(canvas.getByText("italic text").tagName).toBe("EM");
    const link = canvas.getByRole("link", { name: "a link" });
    await expect(link).toHaveAttribute("href", "https://example.com");
  },
};

/** Text event renders fenced code blocks as pre > code elements. */
export const MarkdownCodeBlock: Story = {
  args: {
    event: makeEvent({
      eventType: "text",
      content: "```js\nconst x = 42;\nconsole.log(x);\n```",
    }),
  },
  play: async ({ canvasElement }) => {
    // rehype-prism-plus splits code into <span> tokens for highlighting,
    // so getByText can't find the full string. Query the DOM directly.
    const pre = canvasElement.querySelector("pre");
    await expect(pre).toBeTruthy();
    await expect(pre!.textContent).toContain("const x = 42");
  },
};

/** Text event wraps plain text content in paragraph elements. */
export const MarkdownParagraphWrapping: Story = {
  args: {
    event: makeEvent({
      eventType: "text",
      content: "This is a plain text paragraph.",
    }),
  },
  play: async ({ canvas }) => {
    const paragraph = canvas.getByText("This is a plain text paragraph.");
    await expect(paragraph.tagName).toBe("P");
  },
};

/** System context event renders as collapsible prompt. */
export const SystemContext: Story = {
  args: {
    event: makeEvent({
      eventType: "system",
      content: "You are a helpful assistant.\nYou write clean code.\nYou follow best practices.\nLine 4.\nLine 5.\nLine 6.",
      raw: JSON.stringify({ systemContext: true }),
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("system-context-event")).toBeInTheDocument();
    await expect(canvas.getByText("SYSTEM PROMPT")).toBeInTheDocument();
  },
};
