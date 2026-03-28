import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { EventRenderer } from "./EventRenderer.js";
import { makeEvent } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof EventRenderer> = {
  component: EventRenderer,
  title: "Grackle/Display/EventRenderer",
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof meta>;

// --- Tool card stories (now routed through ToolCard) ---

/** Unpaired tool_result renders as a generic tool card. */
export const ToolResultSuccess: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_result",
      content: "File written successfully",
      raw: JSON.stringify({ is_error: false }),
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-generic")).toBeInTheDocument();
  },
};

/** Paired tool_use+tool_result renders as a specialized card (FileReadCard). */
export const PairedToolUseResult: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_result",
      content: "import express from 'express';",
    }),
    toolUseCtx: { tool: "Read", args: { file_path: "/src/index.ts" } },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-file-read")).toBeInTheDocument();
    await expect(canvas.getByText("index.ts")).toBeInTheDocument();
  },
};

/** Paired Edit tool renders as FileEditCard with diff. */
export const PairedEditResult: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_result",
      content: "File updated",
    }),
    toolUseCtx: {
      tool: "Edit",
      args: { file_path: "/src/config.ts", old_string: "port = 3000", new_string: "port = 8080" },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-file-edit")).toBeInTheDocument();
    await expect(canvas.getByText("config.ts")).toBeInTheDocument();
  },
};

/** Paired Bash tool renders as ShellCard. */
export const PairedShellResult: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_result",
      content: "[exit 0] Tests passed",
    }),
    toolUseCtx: { tool: "Bash", args: { command: "npm test" } },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-shell")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-command")).toHaveTextContent("npm test");
  },
};

/** Unpaired tool_use renders as an in-progress card. */
export const UnpairedToolUse: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_use",
      content: JSON.stringify({ tool: "Read", args: { file_path: "/src/app.ts" } }),
    }),
  },
  play: async ({ canvas }) => {
    // Should render as FileReadCard (in-progress, no result)
    const card = canvas.getByTestId("tool-card-file-read");
    await expect(card.className).toContain("inProgress");
  },
};

/** Error tool_result renders with red accent. */
export const ToolResultError: Story = {
  args: {
    event: makeEvent({
      eventType: "tool_result",
      content: "Error: ENOENT: no such file",
      raw: JSON.stringify({ is_error: true }),
    }),
    toolUseCtx: { tool: "Read", args: { file_path: "/missing.ts" } },
  },
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("tool-card-file-read");
    await expect(card.className).toContain("cardRed");
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
