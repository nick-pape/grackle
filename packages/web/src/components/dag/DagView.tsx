import { useCallback, useMemo, type JSX, type MouseEvent } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type NodeTypes,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useGrackle } from "../../context/GrackleContext.js";
import { useDagLayout, type TaskNodeData } from "./useDagLayout.js";
import { TaskNode } from "./TaskNode.js";
import type { ViewMode } from "../../App.js";
import styles from "./DagView.module.scss";

/** Props for the DagView component. */
interface Props {
  projectId: string;
  setViewMode: (mode: ViewMode) => void;
}

/** CSS variable mapping for MiniMap node coloring by task status. */
const STATUS_VAR_MAP: Record<string, string> = {
  pending: "--text-tertiary",
  assigned: "--accent-blue",
  in_progress: "--accent-green",
  review: "--accent-yellow",
  done: "--accent-green",
  failed: "--accent-red",
  waiting_input: "--accent-yellow",
};

/** Reads a theme-aware color for a task status from CSS custom properties. */
function getStatusColor(status: string): string {
  const varName = STATUS_VAR_MAP[status] || "--text-tertiary";
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || "#6b7a8d";
}

/** Custom node type registry for React Flow. */
const nodeTypes: NodeTypes = {
  task: TaskNode,
};

/** Interactive DAG visualization of task hierarchy and dependency relationships. */
export function DagView({ projectId, setViewMode }: Props): JSX.Element {
  const { tasks } = useGrackle();

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === projectId),
    [tasks, projectId],
  );

  const { nodes, edges } = useDagLayout(projectTasks);

  const onNodeClick = useCallback(
    (_event: MouseEvent, node: Node) => {
      setViewMode({ kind: "task", taskId: node.id });
    },
    [setViewMode],
  );

  /** Returns a hex color for the MiniMap based on task status. */
  const minimapNodeColor = useCallback((node: Node): string => {
    const data = node.data as TaskNodeData;
    return getStatusColor(data.task.status);
  }, []);

  if (projectTasks.length === 0) {
    return (
      <div className={styles.emptyCta}>
        <button
          className={styles.ctaButton}
          onClick={() => setViewMode({ kind: "new_task", projectId })}
        >
          Create Task
        </button>
        <div className={styles.ctaDescription}>
          Create tasks to see the dependency graph
        </div>
      </div>
    );
  }

  return (
    <div className={styles.dagContainer}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--text-disabled)" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={minimapNodeColor}
          maskColor="var(--bg-overlay)"
          style={{ background: "var(--bg-inset)" }}
        />
      </ReactFlow>
    </div>
  );
}
