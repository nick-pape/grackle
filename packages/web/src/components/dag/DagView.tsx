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
import { useThemeContext } from "../../context/ThemeContext.js";
import { useDagLayout, type TaskNodeData } from "./useDagLayout.js";
import { TaskNode } from "./TaskNode.js";
import { taskUrl, newTaskUrl, useAppNavigate } from "../../utils/navigation.js";
import { STATUS_CSS_VAR_MAP } from "../../utils/taskStatus.js";
import styles from "./DagView.module.scss";

/** Props for the DagView component. */
interface Props {
  workspaceId: string;
  environmentId: string;
}

/** CSS variable mapping for MiniMap node coloring by task status. */
const STATUS_VAR_MAP: Record<string, string> = STATUS_CSS_VAR_MAP;

/** Custom node type registry for React Flow. */
const nodeTypes: NodeTypes = {
  task: TaskNode,
};

/** Interactive DAG visualization of task hierarchy and dependency relationships. */
export function DagView({ workspaceId, environmentId }: Props): JSX.Element {
  const { tasks } = useGrackle();
  const navigate = useAppNavigate();
  const { resolvedThemeId } = useThemeContext();

  const workspaceTasks = useMemo(
    () => tasks.filter((t) => t.workspaceId === workspaceId),
    [tasks, workspaceId],
  );

  const { nodes, edges } = useDagLayout(workspaceTasks);

  /** Cached color map — recomputed only when the theme changes. */
  const statusColors = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const colors: Record<string, string> = {};
    for (const [status, varName] of Object.entries(STATUS_VAR_MAP)) {
      colors[status] = style.getPropertyValue(varName).trim() || "#6b7a8d";
    }
    return colors;
  }, [resolvedThemeId]);

  const onNodeClick = useCallback(
    (_event: MouseEvent, node: Node) => {
      navigate(taskUrl(node.id, undefined, workspaceId, environmentId));
    },
    [navigate, workspaceId, environmentId],
  );

  /** Returns a hex color for the MiniMap based on task status. */
  const minimapNodeColor = useCallback((node: Node): string => {
    const data = node.data as TaskNodeData;
    return statusColors[data.task.status] || statusColors.pending;
  }, [statusColors]);

  if (workspaceTasks.length === 0) {
    return (
      <div className={styles.emptyCta}>
        <button
          className={styles.ctaButton}
          onClick={() => navigate(newTaskUrl(workspaceId, undefined, environmentId))}
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
