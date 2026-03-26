import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { TodoCard } from "./TodoCard.js";

const meta: Meta<typeof TodoCard> = {
  component: TodoCard,
  title: "Tools/TodoCard",
};
export default meta;
type Story = StoryObj<typeof meta>;

export const AllPending: Story = {
  name: "Initial - all pending",
  args: {
    tool: "TodoWrite",
    args: {
      todos: [
        { content: "Get bread", activeForm: "Getting bread", status: "pending" },
        { content: "Spread peanut butter", activeForm: "Spreading peanut butter", status: "pending" },
        { content: "Spread jelly", activeForm: "Spreading jelly", status: "pending" },
        { content: "Combine slices", activeForm: "Combining slices", status: "pending" },
        { content: "Cut in half", activeForm: "Cutting in half", status: "pending" },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-todo")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-todo-progress")).toHaveTextContent("0/5");
    await expect(canvas.getAllByTestId("tool-card-todo-item")).toHaveLength(5);
    // No active task when all pending
    await expect(canvas.queryByTestId("tool-card-todo-active")).not.toBeInTheDocument();
  },
};

export const FirstInProgress: Story = {
  name: "Step 1 in progress",
  args: {
    tool: "TodoWrite",
    args: {
      todos: [
        { content: "Get bread", activeForm: "Getting bread", status: "in_progress" },
        { content: "Spread peanut butter", activeForm: "Spreading peanut butter", status: "pending" },
        { content: "Spread jelly", activeForm: "Spreading jelly", status: "pending" },
        { content: "Combine slices", activeForm: "Combining slices", status: "pending" },
        { content: "Cut in half", activeForm: "Cutting in half", status: "pending" },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-todo-progress")).toHaveTextContent("0/5");
    // Active task callout should show the activeForm text
    const active = canvas.getByTestId("tool-card-todo-active");
    await expect(active).toBeInTheDocument();
    await expect(active).toHaveTextContent("Getting bread");
  },
};

export const MidwayThrough: Story = {
  name: "Midway - 2 done, 1 in progress",
  args: {
    tool: "TodoWrite",
    args: {
      todos: [
        { content: "Get bread", activeForm: "Getting bread", status: "completed" },
        { content: "Spread peanut butter", activeForm: "Spreading peanut butter", status: "completed" },
        { content: "Spread jelly", activeForm: "Spreading jelly", status: "in_progress" },
        { content: "Combine slices", activeForm: "Combining slices", status: "pending" },
        { content: "Cut in half", activeForm: "Cutting in half", status: "pending" },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-todo-progress")).toHaveTextContent("2/5");
    await expect(canvas.getByTestId("tool-card-todo-active")).toHaveTextContent("Spreading jelly");
  },
};

export const AllCompleted: Story = {
  name: "All completed",
  args: {
    tool: "TodoWrite",
    args: {
      todos: [
        { content: "Get bread", activeForm: "Getting bread", status: "completed" },
        { content: "Spread peanut butter", activeForm: "Spreading peanut butter", status: "completed" },
        { content: "Spread jelly", activeForm: "Spreading jelly", status: "completed" },
        { content: "Combine slices", activeForm: "Combining slices", status: "completed" },
        { content: "Cut in half", activeForm: "Cutting in half", status: "completed" },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-todo-progress")).toHaveTextContent("5/5");
    // No active task when all done
    await expect(canvas.queryByTestId("tool-card-todo-active")).not.toBeInTheDocument();
  },
};

export const Cleared: Story = {
  name: "Cleared - empty list",
  args: {
    tool: "TodoWrite",
    args: { todos: [] },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-todo")).toBeInTheDocument();
    await expect(canvas.queryByTestId("tool-card-todo-list")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("tool-card-todo-progress")).not.toBeInTheDocument();
  },
};

export const NearEnd: Story = {
  name: "Near end - 4 done, 1 in progress",
  args: {
    tool: "TodoWrite",
    args: {
      todos: [
        { content: "Get bread", activeForm: "Getting bread", status: "completed" },
        { content: "Spread peanut butter", activeForm: "Spreading peanut butter", status: "completed" },
        { content: "Spread jelly", activeForm: "Spreading jelly", status: "completed" },
        { content: "Combine slices", activeForm: "Combining slices", status: "completed" },
        { content: "Cut in half", activeForm: "Cutting in half", status: "in_progress" },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-todo-progress")).toHaveTextContent("4/5");
    await expect(canvas.getByTestId("tool-card-todo-active")).toHaveTextContent("Cutting in half");
  },
};

export const NoActiveForm: Story = {
  name: "No activeForm - falls back to content",
  args: {
    tool: "TodoWrite",
    args: {
      todos: [
        { content: "Research API options", status: "in_progress" },
        { content: "Write implementation", status: "pending" },
        { content: "Add tests", status: "pending" },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-todo-active")).toHaveTextContent("Research API options");
  },
};

// --- Codex update_plan format ---

export const CodexPlan: Story = {
  name: "Codex - update_plan format",
  args: {
    tool: "update_plan",
    args: {
      explanation: "Working through the sandwich steps",
      plan: [
        { step: "Get bread from pantry", status: "completed" },
        { step: "Spread peanut butter on slice", status: "in_progress" },
        { step: "Spread jelly on other slice", status: "pending" },
        { step: "Combine slices together", status: "pending" },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-todo-progress")).toHaveTextContent("1/4");
    await expect(canvas.getByTestId("tool-card-todo-active")).toHaveTextContent("Spread peanut butter on slice");
    await expect(canvas.getAllByTestId("tool-card-todo-item")).toHaveLength(4);
  },
};

// --- Goose todo_write format (markdown checklist) ---

export const GooseMarkdown: Story = {
  name: "Goose - markdown checklist",
  args: {
    tool: "todo_write",
    args: {
      content: "- [x] Get two slices of bread\n- [x] Open peanut butter jar\n- [~] Spread PB on first slice\n- [ ] Spread jelly on second slice\n- [ ] Press slices together\n- [ ] Cut diagonally",
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-todo-progress")).toHaveTextContent("2/6");
    await expect(canvas.getByTestId("tool-card-todo-active")).toHaveTextContent("Spread PB on first slice");
    await expect(canvas.getAllByTestId("tool-card-todo-item")).toHaveLength(6);
  },
};

export const GooseAllChecked: Story = {
  name: "Goose - all checked off",
  args: {
    tool: "todo_write",
    args: {
      content: "- [x] Get bread\n- [x] Spread PB\n- [x] Spread jelly\n- [x] Combine\n- [x] Cut",
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-todo-progress")).toHaveTextContent("5/5");
    await expect(canvas.queryByTestId("tool-card-todo-active")).not.toBeInTheDocument();
  },
};
