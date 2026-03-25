import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor } from "@storybook/test";
import { TaskList } from "./TaskList.js";
import type { Workspace } from "../../hooks/types.js";
import { buildTask, buildWorkspace } from "../../test-utils/storybook-helpers.js";

const WORKSPACE_ID: string = "ws-tasklist";

const defaultWorkspace: Workspace = buildWorkspace({ id: WORKSPACE_ID, name: "Test Workspace" });

const meta: Meta<typeof TaskList> = {
  title: "Lists/TaskList",
  component: TaskList,
  decorators: [
    (Story) => {
      // Clear localStorage to prevent state pollution between stories.
      // TaskList persists groupByStatus and stream direction in localStorage.
      localStorage.removeItem("grackle-task-group-by-status");
      localStorage.removeItem("grackle-stream-direction");
      return (
        <div style={{ width: "300px", height: "600px", overflow: "auto" }}>
          <Story />
        </div>
      );
    },
  ],
  args: {
    workspaces: [defaultWorkspace],
    tasks: [],
  },
};

export default meta;

type Story = StoryObj<typeof TaskList>;

// ---------------------------------------------------------------------------
// multi-task.spec.ts: "tasks sidebar shows multiple tasks"
// ---------------------------------------------------------------------------

/**
 * Multiple tasks appear in the sidebar task list.
 * Migrated from multi-task.spec.ts: "tasks sidebar shows multiple tasks".
 */
export const MultipleTasks: Story = {
  name: "Sidebar shows multiple tasks",
  args: {
    tasks: [
      buildTask({ id: "t-alpha", workspaceId: WORKSPACE_ID, title: "task-alpha", sortOrder: 1 }),
      buildTask({ id: "t-bravo", workspaceId: WORKSPACE_ID, title: "task-bravo", sortOrder: 2 }),
      buildTask({ id: "t-charlie", workspaceId: WORKSPACE_ID, title: "task-charlie", sortOrder: 3 }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("task-alpha")).toBeInTheDocument();
    await expect(canvas.getByText("task-bravo")).toBeInTheDocument();
    await expect(canvas.getByText("task-charlie")).toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// group-by-status.spec.ts
// ---------------------------------------------------------------------------

/**
 * Toggling the group-by-status button shows status group headers.
 * Migrated from group-by-status.spec.ts: "toggle switches to grouped view with status group headers".
 */
export const GroupByStatusToggle: Story = {
  name: "Group-by-status toggle shows headers",
  args: {
    tasks: [
      buildTask({ id: "t-a", workspaceId: WORKSPACE_ID, title: "task-a", status: "not_started", sortOrder: 1 }),
      buildTask({ id: "t-b", workspaceId: WORKSPACE_ID, title: "task-b", status: "not_started", sortOrder: 2 }),
    ],
  },
  play: async ({ canvas }) => {
    // Click the group-by-status toggle
    const toggle = canvas.getByTestId("task-group-by-status-toggle");
    await userEvent.click(toggle);

    // Status group header for not_started should appear
    const notStartedGroup = canvas.getByTestId("status-group-not_started");
    await expect(notStartedGroup).toBeInTheDocument();

    // Tasks should still be visible within the group
    await expect(canvas.getByText("task-a")).toBeInTheDocument();
    await expect(canvas.getByText("task-b")).toBeInTheDocument();
  },
};

/**
 * Clicking a status group header collapses and re-expands its task list.
 * Migrated from group-by-status.spec.ts: "collapse and expand a status group".
 */
export const GroupCollapseExpand: Story = {
  name: "Collapse and expand status group",
  args: {
    tasks: [
      buildTask({ id: "t-collapse", workspaceId: WORKSPACE_ID, title: "collapse-task", status: "not_started", sortOrder: 1 }),
    ],
  },
  play: async ({ canvas }) => {
    // Enable group-by-status
    const toggle = canvas.getByTestId("task-group-by-status-toggle");
    await userEvent.click(toggle);

    const groupHeader = canvas.getByTestId("status-group-not_started");
    await expect(groupHeader).toBeInTheDocument();
    await expect(canvas.getByText("collapse-task")).toBeInTheDocument();

    // Click the header's role="button" to collapse
    const collapseButton = groupHeader.querySelector('[role="button"]') as HTMLElement;
    await userEvent.click(collapseButton);

    // Task should be hidden after collapse (wait for exit animation to complete)
    await waitFor(async () => {
      await expect(canvas.queryByText("collapse-task")).not.toBeInTheDocument();
    });

    // Click again to expand
    await userEvent.click(collapseButton);

    // Task should reappear
    await expect(await canvas.findByText("collapse-task")).toBeInTheDocument();
  },
};

/**
 * Empty status groups are not rendered (only groups with tasks are shown).
 * Migrated from group-by-status.spec.ts: "empty status groups are hidden".
 */
export const EmptyGroupsHidden: Story = {
  name: "Empty status groups are hidden",
  args: {
    tasks: [
      buildTask({ id: "t-only", workspaceId: WORKSPACE_ID, title: "only-not-started", status: "not_started", sortOrder: 1 }),
    ],
  },
  play: async ({ canvas }) => {
    // Enable group-by-status
    const toggle = canvas.getByTestId("task-group-by-status-toggle");
    await userEvent.click(toggle);

    // The not_started group should exist
    await expect(canvas.getByTestId("status-group-not_started")).toBeInTheDocument();

    // Other groups should NOT exist (no tasks in those statuses)
    await expect(canvas.queryByTestId("status-group-working")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("status-group-complete")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("status-group-failed")).not.toBeInTheDocument();
  },
};

/**
 * Toggling group-by-status off restores the tree view.
 * Migrated from group-by-status.spec.ts: "toggle back restores tree view".
 */
export const ToggleBackRestoresTree: Story = {
  name: "Toggle off restores tree view",
  args: {
    tasks: [
      buildTask({ id: "t-restore", workspaceId: WORKSPACE_ID, title: "restore-parent", status: "not_started", sortOrder: 1 }),
    ],
  },
  play: async ({ canvas }) => {
    const toggle = canvas.getByTestId("task-group-by-status-toggle");

    // Enable grouped view
    await userEvent.click(toggle);
    await expect(canvas.getByTestId("status-group-not_started")).toBeInTheDocument();

    // Disable grouped view
    await userEvent.click(toggle);

    // Status groups should be gone
    await expect(canvas.queryByTestId("status-group-not_started")).not.toBeInTheDocument();

    // Tree tasks should be visible
    await expect(canvas.getByText("restore-parent")).toBeInTheDocument();
  },
};

/**
 * Tasks are navigable from grouped view (clicking a task row).
 * Migrated from group-by-status.spec.ts: "task navigation from grouped view".
 */
export const TaskNavigationFromGroupedView: Story = {
  name: "Task navigation from grouped view",
  args: {
    tasks: [
      buildTask({ id: "t-nav", workspaceId: WORKSPACE_ID, title: "nav-target", status: "not_started", sortOrder: 1 }),
    ],
  },
  play: async ({ canvas }) => {
    // Enable grouped view
    const toggle = canvas.getByTestId("task-group-by-status-toggle");
    await userEvent.click(toggle);

    await expect(canvas.getByTestId("status-group-not_started")).toBeInTheDocument();

    // The task should be visible and clickable
    const taskElement = canvas.getByText("nav-target");
    await expect(taskElement).toBeInTheDocument();
    await userEvent.click(taskElement);
  },
};

// ---------------------------------------------------------------------------
// keyboard interaction
// ---------------------------------------------------------------------------

/**
 * Pressing Enter on a status group header toggles collapse/expand.
 */
export const KeyboardToggleGroup: Story = {
  name: "Enter toggles group collapse",
  args: {
    tasks: [
      buildTask({ id: "t-kb", workspaceId: WORKSPACE_ID, title: "kb-toggle-task", status: "not_started", sortOrder: 1 }),
    ],
  },
  play: async ({ canvas }) => {
    // Enable group-by-status
    const toggle = canvas.getByTestId("task-group-by-status-toggle");
    await userEvent.click(toggle);

    const groupHeader = canvas.getByTestId("status-group-not_started");
    await expect(groupHeader).toBeInTheDocument();

    // Focus the collapse button and press Enter
    const collapseButton = groupHeader.querySelector('[role="button"]') as HTMLElement;
    collapseButton.focus();
    await userEvent.keyboard("{Enter}");

    // Task should be hidden
    await waitFor(async () => {
      await expect(canvas.queryByText("kb-toggle-task")).not.toBeInTheDocument();
    });

    // Press Enter again to expand
    await userEvent.keyboard("{Enter}");
    await expect(await canvas.findByText("kb-toggle-task")).toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// sidebar-search.spec.ts
// ---------------------------------------------------------------------------

/**
 * The search input is visible when tasks exist.
 * Migrated from sidebar-search.spec.ts: "search input is visible when tasks exist".
 */
export const SearchInputVisible: Story = {
  name: "Search input visible when tasks exist",
  args: {
    tasks: [
      buildTask({ id: "t-vis", workspaceId: WORKSPACE_ID, title: "visible-task", sortOrder: 1 }),
    ],
  },
  play: async ({ canvas }) => {
    const searchInput = canvas.getByTestId("sidebar-search");
    await expect(searchInput).toBeInTheDocument();
  },
};

/**
 * Typing in the search input filters tasks by title.
 * Migrated from sidebar-search.spec.ts: "typing filters tasks by title".
 */
export const SearchFiltersTasksByTitle: Story = {
  name: "Typing filters tasks by title",
  args: {
    tasks: [
      buildTask({ id: "t-alpha", workspaceId: WORKSPACE_ID, title: "alpha-task", sortOrder: 1 }),
      buildTask({ id: "t-beta", workspaceId: WORKSPACE_ID, title: "beta-task", sortOrder: 2 }),
    ],
  },
  play: async ({ canvas }) => {
    const searchInput = canvas.getByTestId("sidebar-search");
    await expect(searchInput).toBeInTheDocument();

    // Type a filter matching only one task
    await userEvent.clear(searchInput);
    await userEvent.type(searchInput, "alpha");

    // Only the matching task should remain.
    // After search, HighlightedText splits text into <mark>/<span> fragments,
    // so use the title attribute on the task title span instead of getByText.
    await waitFor(async () => {
      await expect(canvas.getByTitle("alpha-task")).toBeInTheDocument();
    });
    await expect(canvas.queryByTitle("beta-task")).not.toBeInTheDocument();
  },
};

/**
 * Clearing the search filter restores the full task list.
 * Migrated from sidebar-search.spec.ts: "clearing filter restores full list".
 */
export const ClearingFilterRestoresList: Story = {
  name: "Clearing filter restores full list",
  args: {
    tasks: [
      buildTask({ id: "t-ca", workspaceId: WORKSPACE_ID, title: "clear-alpha", sortOrder: 1 }),
      buildTask({ id: "t-cb", workspaceId: WORKSPACE_ID, title: "clear-beta", sortOrder: 2 }),
    ],
  },
  play: async ({ canvas }) => {
    const searchInput = canvas.getByTestId("sidebar-search");

    // Filter to one task
    await userEvent.clear(searchInput);
    await userEvent.type(searchInput, "clear-alpha");
    await expect(canvas.queryByText("clear-beta")).not.toBeInTheDocument();

    // Clear the filter
    await userEvent.clear(searchInput);

    // Both tasks should be visible again
    await expect(canvas.getByText("clear-alpha")).toBeInTheDocument();
    await expect(canvas.getByText("clear-beta")).toBeInTheDocument();
  },
};

/**
 * Matching text in task titles is highlighted with a <mark> element.
 * Migrated from sidebar-search.spec.ts: "matching text in task titles is highlighted".
 */
export const SearchHighlightsMatches: Story = {
  name: "Search highlights matching text",
  args: {
    tasks: [
      buildTask({ id: "t-hl", workspaceId: WORKSPACE_ID, title: "Fix login bug", sortOrder: 1 }),
    ],
  },
  play: async ({ canvas }) => {
    const searchInput = canvas.getByTestId("sidebar-search");

    await userEvent.clear(searchInput);
    await userEvent.type(searchInput, "login");

    // The task should be visible with "login" highlighted in a <mark> element
    const marks = canvas.getAllByText("login");
    // At least one should be a <mark> element
    const markElement = marks.find((el) => el.tagName === "MARK");
    await expect(markElement).toBeTruthy();
  },
};

// ---------------------------------------------------------------------------
// task-tree.spec.ts: breadcrumbs
// ---------------------------------------------------------------------------

/**
 * Breadcrumb rendering for a nested child task shows the ancestor chain.
 * Migrated from task-tree.spec.ts: "breadcrumbs show ancestor chain for nested task".
 *
 * NOTE: Breadcrumbs are rendered by the task detail page (not TaskList itself).
 * This story instead verifies the tree structure: parent with expand arrow and
 * child visible in the tree hierarchy.
 */
export const TreeWithParentAndChild: Story = {
  name: "Tree structure with parent and child",
  args: {
    tasks: [
      buildTask({
        id: "t-root",
        workspaceId: WORKSPACE_ID,
        title: "bc-root",
        status: "not_started",
        canDecompose: true,
        childTaskIds: ["t-child"],
        sortOrder: 1,
      }),
      buildTask({
        id: "t-child",
        workspaceId: WORKSPACE_ID,
        title: "bc-child",
        status: "not_started",
        parentTaskId: "t-root",
        depth: 1,
        sortOrder: 1,
      }),
    ],
  },
  play: async ({ canvas }) => {
    // Parent task should be visible
    await expect(canvas.getByText("bc-root")).toBeInTheDocument();

    // Child task should be visible (auto-expanded via useEffect, wait for async render)
    await expect(await canvas.findByText("bc-child")).toBeInTheDocument();

    // Parent row should show a child count badge "0/1" (0 complete out of 1)
    const parentRow = canvas.getByText("bc-root").closest("[data-task-id]");
    await expect(parentRow).toBeInTheDocument();
    await expect(parentRow).toHaveTextContent(/0\/1/);
  },
};
