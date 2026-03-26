import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { ShellCard } from "./ShellCard.js";

const meta: Meta<typeof ShellCard> = {
  component: ShellCard,
  title: "Tools/ShellCard",
};
export default meta;
type Story = StoryObj<typeof meta>;

export const SuccessWithOutput: Story = {
  name: "Success - exit 0",
  args: {
    tool: "Bash",
    args: { command: "npm test -- --grep auth" },
    result: "[exit 0] > jest --grep auth\n\n PASS  src/auth.test.ts\n  ✓ validates JWT token (12ms)\n  ✓ rejects expired token (3ms)\n  ✓ handles missing header (1ms)\n\nTests: 3 passed, 3 total\nTime:  1.234s",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-shell")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-command")).toHaveTextContent("npm test -- --grep auth");
    await expect(canvas.getByTestId("tool-card-exit-code")).toHaveTextContent("✓ exit 0");
    // Should have toggle (>3 lines)
    await expect(canvas.getByTestId("tool-card-toggle")).toBeInTheDocument();
  },
};

export const ErrorExit: Story = {
  name: "Failure - exit 1",
  args: {
    tool: "Bash",
    args: { command: "npm run build" },
    result: "[exit 1] src/index.ts(14,5): error TS2304: Cannot find name 'foo'.",
    isError: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-exit-code")).toHaveTextContent("✗ exit 1");
    const card = canvas.getByTestId("tool-card-shell");
    await expect(card.className).toContain("cardRed");
  },
};

export const PowerShellWrapper: Story = {
  name: "Codex - PowerShell wrapper simplified",
  args: {
    tool: "command_execution",
    args: { command: '"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe" -Command \'Get-Content -Path README.md\'' },
    result: "[exit 0] # Grackle\n\nRun any AI coding agent...",
  },
  play: async ({ canvas }) => {
    // Should strip the PowerShell wrapper
    await expect(canvas.getByTestId("tool-card-command")).toHaveTextContent("Get-Content -Path README.md");
  },
};

export const LongOutput: Story = {
  name: "Long output - expand/collapse",
  args: {
    tool: "Bash",
    args: { command: "git log --oneline -10" },
    result: "abc1234 feat: add auth\ndef5678 fix: typo\nghi9012 chore: deps\njkl3456 docs: readme\nmno7890 test: add coverage\npqr1234 refactor: cleanup",
  },
  play: async ({ canvas }) => {
    const toggle = canvas.getByTestId("tool-card-toggle");
    await expect(toggle).toBeInTheDocument();
    await expect(toggle.textContent).toContain("3 more lines");

    await userEvent.click(toggle);
    await expect(toggle.textContent).toContain("collapse");

    await userEvent.click(toggle);
    await expect(toggle.textContent).toContain("more lines");
  },
};

export const InProgress: Story = {
  args: {
    tool: "Bash",
    args: { command: "npm install" },
    // No result yet
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-pending")).toBeInTheDocument();
    await expect(canvas.queryByTestId("tool-card-output")).not.toBeInTheDocument();
  },
};

export const EmptyOutput: Story = {
  name: "Exit 0 - no output",
  args: {
    tool: "Bash",
    args: { command: "mkdir -p dist" },
    result: "[exit 0] ",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-exit-code")).toHaveTextContent("✓ exit 0");
  },
};

export const NoExitCode: Story = {
  name: "Plain output (no exit code prefix)",
  args: {
    tool: "Bash",
    args: { command: "echo hello" },
    result: "hello",
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId("tool-card-exit-code")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-output")).toHaveTextContent("hello");
  },
};
