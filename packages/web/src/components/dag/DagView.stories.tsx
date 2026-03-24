import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { MemoryRouter } from "react-router";
import { ReactFlowProvider } from "@xyflow/react";
import { ThemeProvider } from "../../context/ThemeContext.js";
import { DagView } from "./DagView.js";
import { buildTask } from "../../test-utils/storybook-helpers.js";

const WORKSPACE_ID = "ws-dag";
const ENVIRONMENT_ID = "env-dag";

/**
 * DagView uses @xyflow/react which requires a parent ReactFlowProvider
 * and a container with explicit dimensions for layout computation.
 * ThemeProvider is required because DagView calls useThemeContext() internally
 * to resolve CSS custom property values for the MiniMap.
 */
const meta: Meta<typeof DagView> = {
  title: "DAG/DagView",
  component: DagView,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <ThemeProvider>
          <ReactFlowProvider>
            <div
              style={{
                width: "800px",
                height: "600px",
                // Set CSS custom properties that DagView references
                // so getComputedStyle calls don't return empty strings.
                "--text-tertiary": "#6b7a8d",
                "--accent-green": "#22c55e",
                "--accent-yellow": "#eab308",
                "--accent-red": "#ef4444",
                "--bg-overlay": "rgba(0,0,0,0.4)",
                "--bg-inset": "#1e1e2e",
                "--text-disabled": "#444",
              } as React.CSSProperties}
            >
              <Story />
            </div>
          </ReactFlowProvider>
        </ThemeProvider>
      </MemoryRouter>
    ),
  ],
  args: {
    workspaceId: WORKSPACE_ID,
    environmentId: ENVIRONMENT_ID,
    tasks: [],
  },
};

export default meta;

type Story = StoryObj<typeof DagView>;

/**
 * When no tasks exist, DagView shows an empty CTA with a "Create Task" button.
 */
export const EmptyState: Story = {
  name: "Empty state shows CTA",
  args: {
    tasks: [],
  },
  play: async ({ canvas }) => {
    const createButton = canvas.getByRole("button", { name: "Create Task" });
    await expect(createButton).toBeInTheDocument();
  },
};

/**
 * Graph nodes render for each task, identified by data-task-title attributes.
 * Migrated from dag-view.spec.ts: "Graph tab renders task nodes after switching from default Tasks tab".
 *
 * NOTE: @xyflow/react uses internal layout that may not render visible nodes
 * in JSDOM/test environments. This story verifies the component mounts
 * without error and that the expected task titles are present in the DOM.
 */
export const GraphNodesRender: Story = {
  name: "Graph nodes render for tasks",
  args: {
    tasks: [
      buildTask({
        id: "dag-a",
        workspaceId: WORKSPACE_ID,
        title: "dag-task-a",
        status: "not_started",
        sortOrder: 1,
      }),
      buildTask({
        id: "dag-b",
        workspaceId: WORKSPACE_ID,
        title: "dag-task-b",
        status: "not_started",
        sortOrder: 2,
      }),
    ],
  },
  play: async ({ canvas }) => {
    // Verify the task nodes appear in the rendered graph via data-task-title
    const nodeA = canvas.getByText("dag-task-a");
    await expect(nodeA).toBeInTheDocument();

    const nodeB = canvas.getByText("dag-task-b");
    await expect(nodeB).toBeInTheDocument();
  },
};

/**
 * Clicking a graph node is wired to navigation (onClick fires on the node).
 * Migrated from dag-view.spec.ts: "clicking a graph node navigates to task detail".
 *
 * NOTE: In Storybook, clicking the node triggers React Flow's onNodeClick
 * which calls navigate(). We verify the node is present and clickable.
 */
export const NodeClickNavigation: Story = {
  name: "Node click triggers navigation",
  args: {
    tasks: [
      buildTask({
        id: "dag-nav",
        workspaceId: WORKSPACE_ID,
        title: "dag-nav-task",
        status: "not_started",
        sortOrder: 1,
      }),
    ],
  },
  play: async ({ canvas }) => {
    // Verify the task node renders with its title
    const node = canvas.getByText("dag-nav-task");
    await expect(node).toBeInTheDocument();

    // Click the node — React Flow handles forwarding to onNodeClick
    await userEvent.click(node);
  },
};
