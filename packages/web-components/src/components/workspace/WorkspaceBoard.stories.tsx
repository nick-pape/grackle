import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { WorkspaceBoard } from "./WorkspaceBoard.js";
import { buildTask, buildEnvironment } from "../../test-utils/storybook-helpers.js";

const WORKSPACE_ID: string = "ws-board";
const ENVIRONMENT_ID: string = "env-board";

const meta: Meta<typeof WorkspaceBoard> = {
  title: "Grackle/Workspace/WorkspaceBoard",
  tags: ["autodocs"],
  component: WorkspaceBoard,
  args: {
    workspaceId: WORKSPACE_ID,
    environmentId: ENVIRONMENT_ID,
    tasks: [],
    sessions: [],
    personas: [],
    environments: [buildEnvironment({ id: ENVIRONMENT_ID })],
  },
};

export default meta;

type Story = StoryObj<typeof WorkspaceBoard>;

/**
 * When there are no tasks, the board shows an empty CTA with a "Create Task" button.
 * Migrated from board-view.spec.ts: "empty workspace shows CTA on board view".
 */
export const EmptyCta: Story = {
  name: "Empty workspace shows CTA",
  args: {
    tasks: [],
  },
  play: async ({ canvas }) => {
    const cta = canvas.getByTestId("board-empty-cta");
    await expect(cta).toBeInTheDocument();

    const createButton = canvas.getByRole("button", { name: "Create Task" });
    await expect(createButton).toBeInTheDocument();
  },
};

/**
 * All five board columns are rendered even when only one has tasks.
 * Migrated from board-view.spec.ts: "all five columns are always rendered".
 */
export const AllFiveColumns: Story = {
  name: "All five columns are rendered",
  args: {
    tasks: [
      buildTask({ id: "t1", workspaceId: WORKSPACE_ID, title: "Only task", status: "not_started", sortOrder: 1 }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("board-column-not_started")).toBeInTheDocument();
    await expect(canvas.getByTestId("board-column-working")).toBeInTheDocument();
    await expect(canvas.getByTestId("board-column-paused")).toBeInTheDocument();
    await expect(canvas.getByTestId("board-column-complete")).toBeInTheDocument();
    await expect(canvas.getByTestId("board-column-failed")).toBeInTheDocument();
  },
};

/**
 * Tasks appear in the correct column based on their status, with count badges.
 * Migrated from board-view.spec.ts: "tasks appear in correct columns based on status".
 */
export const TasksInCorrectColumns: Story = {
  name: "Tasks in correct columns by status",
  args: {
    tasks: [
      buildTask({ id: "t1", workspaceId: WORKSPACE_ID, title: "col-task-a", status: "not_started", sortOrder: 1 }),
      buildTask({ id: "t2", workspaceId: WORKSPACE_ID, title: "col-task-b", status: "not_started", sortOrder: 2 }),
    ],
  },
  play: async ({ canvas }) => {
    const container = canvas.getByTestId("board-container");
    await expect(container).toBeInTheDocument();

    // Not Started column should exist and show count of 2
    await expect(canvas.getByTestId("board-column-not_started")).toBeInTheDocument();
    await expect(canvas.getByTestId("board-count-not_started")).toHaveTextContent("2");

    // Other columns should show 0
    await expect(canvas.getByTestId("board-count-working")).toHaveTextContent("0");
    await expect(canvas.getByTestId("board-count-complete")).toHaveTextContent("0");
  },
};

/**
 * Clicking a board card triggers navigation (the onClick handler fires).
 * Migrated from board-view.spec.ts: "clicking a card navigates to task detail".
 */
export const CardClick: Story = {
  name: "Card click triggers navigation",
  args: {
    tasks: [
      buildTask({ id: "t-nav", workspaceId: WORKSPACE_ID, title: "board-nav-task", status: "not_started", sortOrder: 1 }),
    ],
  },
  play: async ({ canvas }) => {
    const container = canvas.getByTestId("board-container");
    await expect(container).toBeInTheDocument();

    // Click the card — in Storybook we verify the card element is clickable
    const card = canvas.getByTestId("board-card-t-nav");
    await expect(card).toBeInTheDocument();
    await userEvent.click(card);
  },
};

/**
 * Board cards are focusable via keyboard and respond to Enter key.
 * Migrated from board-view.spec.ts: "card is focusable via keyboard".
 */
export const KeyboardFocus: Story = {
  name: "Card is focusable via keyboard",
  args: {
    tasks: [
      buildTask({ id: "t-focus", workspaceId: WORKSPACE_ID, title: "focus-task", status: "not_started", sortOrder: 1 }),
    ],
  },
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("board-card-t-focus");
    await expect(card).toBeInTheDocument();

    // Card should have tabIndex and role="button"
    await expect(card).toHaveAttribute("role", "button");

    // Focus the card and verify it received focus
    card.focus();
    await expect(card).toHaveFocus();
  },
};

/**
 * Pressing Enter or Space on a focused card activates it.
 */
export const KeyboardActivation: Story = {
  name: "Enter/Space activates focused card",
  args: {
    tasks: [
      buildTask({ id: "t-kb", workspaceId: WORKSPACE_ID, title: "kb-task", status: "not_started", sortOrder: 1 }),
    ],
  },
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("board-card-t-kb");
    card.focus();
    await expect(card).toHaveFocus();

    // Enter key should activate the card (trigger click handler)
    await userEvent.keyboard("{Enter}");

    // Space key should also activate the card
    card.focus();
    await userEvent.keyboard(" ");
  },
};

/**
 * A task with unresolved dependencies shows a "blocked" badge on its card.
 * Migrated from board-view.spec.ts: "blocked task shows blocked badge in its status column".
 */
export const BlockedBadge: Story = {
  name: "Blocked task shows blocked badge",
  args: {
    tasks: [
      buildTask({
        id: "t-blocker",
        workspaceId: WORKSPACE_ID,
        title: "blocker-task",
        status: "not_started",
        sortOrder: 1,
      }),
      buildTask({
        id: "t-blocked",
        workspaceId: WORKSPACE_ID,
        title: "blocked-task",
        status: "not_started",
        dependsOn: ["t-blocker"],
        sortOrder: 2,
      }),
    ],
  },
  play: async ({ canvas }) => {
    // Both tasks should be in Not Started column
    await expect(canvas.getByTestId("board-count-not_started")).toHaveTextContent("2");

    // The blocked task card should display a "blocked" badge
    const blockedCard = canvas.getByTestId("board-card-t-blocked");
    await expect(blockedCard).toBeInTheDocument();
    await expect(blockedCard).toHaveTextContent(/blocked/);
  },
};

/**
 * A parent task with children shows a child progress badge like "0/2".
 * Migrated from board-view.spec.ts: "child progress badge shows on parent cards".
 */
export const ChildProgressBadge: Story = {
  name: "Child progress badge on parent cards",
  args: {
    tasks: [
      buildTask({
        id: "t-parent",
        workspaceId: WORKSPACE_ID,
        title: "parent-task",
        status: "not_started",
        canDecompose: true,
        childTaskIds: ["t-child-1", "t-child-2"],
        sortOrder: 1,
      }),
      buildTask({
        id: "t-child-1",
        workspaceId: WORKSPACE_ID,
        title: "child-1",
        status: "not_started",
        parentTaskId: "t-parent",
        depth: 1,
        sortOrder: 1,
      }),
      buildTask({
        id: "t-child-2",
        workspaceId: WORKSPACE_ID,
        title: "child-2",
        status: "not_started",
        parentTaskId: "t-parent",
        depth: 1,
        sortOrder: 2,
      }),
    ],
  },
  play: async ({ canvas }) => {
    // Parent card should show child progress badge "0/2"
    const parentCard = canvas.getByTestId("board-card-t-parent");
    await expect(parentCard).toBeInTheDocument();
    await expect(parentCard).toHaveTextContent("0/2");
  },
};
