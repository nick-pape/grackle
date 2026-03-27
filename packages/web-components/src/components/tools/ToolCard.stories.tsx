import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { ToolCard } from "./ToolCard.js";

const meta: Meta<typeof ToolCard> = {
  component: ToolCard,
  title: "Tools/ToolCard",
};
export default meta;
type Story = StoryObj<typeof meta>;

/** File read tool renders the file-read card variant. */
export const FileRead: Story = {
  args: {
    tool: "Read",
    args: { file_path: "/src/index.ts", limit: 50 },
    result: "import express from 'express';\n\nconst app = express();\napp.listen(3000);",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-file-read")).toBeInTheDocument();
    await expect(canvas.getByText("index.ts")).toBeInTheDocument();
  },
};

/** Shell command tool renders the shell card variant. */
export const ShellCommand: Story = {
  args: {
    tool: "Bash",
    args: { command: "npm test" },
    result: "[exit 0] All tests passed.",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-shell")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-command")).toHaveTextContent("npm test");
  },
};

/** Unknown tool name falls through to the generic card. */
export const GenericTool: Story = {
  args: {
    tool: "MyCustomTool",
    args: { query: "search term" },
    result: "Found 3 results.",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-generic")).toBeInTheDocument();
    await expect(canvas.getByText("MyCustomTool")).toBeInTheDocument();
  },
};
