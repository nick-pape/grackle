import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { ReactFlowProvider } from "@xyflow/react";
import { TaskNode } from "./TaskNode.js";
import { makeTask } from "../../test-utils/storybook-helpers.js";
import type { NodeProps } from "@xyflow/react";

/**
 * Wrapper that provides ReactFlowProvider context and minimal
 * node props so TaskNode can render outside a full React Flow canvas.
 */
function TaskNodeWrapper(props: { data: Record<string, unknown> }): React.JSX.Element {
  const nodeProps = {
    id: "node-1",
    data: props.data,
    type: "task",
    selected: false,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    zIndex: 0,
    dragging: false,
    deletable: false,
    selectable: false,
    parentId: undefined,
    sourcePosition: undefined,
    targetPosition: undefined,
    width: 220,
    height: 70,
  } as unknown as NodeProps;

  return (
    <ReactFlowProvider>
      <div style={{ padding: 40, position: "relative" }}>
        <TaskNode {...nodeProps} />
      </div>
    </ReactFlowProvider>
  );
}

const meta: Meta<typeof TaskNodeWrapper> = {
  component: TaskNodeWrapper,
  title: "DAG/TaskNode",
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Default not-started task node. */
export const Default: Story = {
  args: {
    data: {
      task: makeTask({ id: "t1", title: "Setup CI pipeline", status: "not_started" }),
      childCount: 0,
      doneChildCount: 0,
      hasDependencies: false,
    },
  },
  play: async ({ canvas }) => {
    const node = canvas.getByText("Setup CI pipeline");
    await expect(node).toBeInTheDocument();
  },
};

/** Working task node shows the working status color. */
export const Working: Story = {
  args: {
    data: {
      task: makeTask({ id: "t2", title: "Implement auth", status: "working" }),
      childCount: 0,
      doneChildCount: 0,
      hasDependencies: false,
    },
  },
  play: async ({ canvas }) => {
    const node = canvas.getByText("Implement auth");
    await expect(node).toBeInTheDocument();
  },
};

/** Completed task node. */
export const Complete: Story = {
  args: {
    data: {
      task: makeTask({ id: "t3", title: "Write tests", status: "complete" }),
      childCount: 0,
      doneChildCount: 0,
      hasDependencies: false,
    },
  },
  play: async ({ canvas }) => {
    const node = canvas.getByText("Write tests");
    await expect(node).toBeInTheDocument();
  },
};

/** Task node with child subtask counts displayed as a badge. */
export const WithChildren: Story = {
  args: {
    data: {
      task: makeTask({ id: "t4", title: "Build feature", status: "working" }),
      childCount: 5,
      doneChildCount: 3,
      hasDependencies: false,
    },
  },
  play: async ({ canvas }) => {
    const node = canvas.getByText("Build feature");
    await expect(node).toBeInTheDocument();
    // Child badge should show "3/5"
    const badge = canvas.getByText("3/5");
    await expect(badge).toBeInTheDocument();
  },
};

/** Task node with dependency badge. */
export const Blocked: Story = {
  args: {
    data: {
      task: makeTask({ id: "t5", title: "Deploy to prod", status: "not_started" }),
      childCount: 0,
      doneChildCount: 0,
      hasDependencies: true,
    },
  },
  play: async ({ canvas }) => {
    const node = canvas.getByText("Deploy to prod");
    await expect(node).toBeInTheDocument();
    // Dependency badge
    const depBadge = canvas.getByText("dep");
    await expect(depBadge).toBeInTheDocument();
  },
};
