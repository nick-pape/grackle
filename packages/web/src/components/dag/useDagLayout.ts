import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { TaskData } from "../../hooks/useGrackleSocket.js";

/** Width of each task node in the DAG layout (pixels). */
const NODE_WIDTH: number = 220;
/** Height of each task node in the DAG layout (pixels). */
const NODE_HEIGHT: number = 70;
/** Horizontal separation between sibling nodes (pixels). */
const NODE_SEPARATION: number = 40;
/** Vertical separation between rank levels (pixels). */
const RANK_SEPARATION: number = 60;

/** Edge type identifier for parent→child (hierarchy) edges. */
const EDGE_TYPE_HIERARCHY: string = "hierarchy";
/** Edge type identifier for dependency edges. */
const EDGE_TYPE_DEPENDENCY: string = "dependency";

/** Data attached to each React Flow task node. */
export interface TaskNodeData extends Record<string, unknown> {
  task: TaskData;
  childCount: number;
  doneChildCount: number;
  hasDependencies: boolean;
}

/** Result of the DAG layout computation. */
export interface DagLayoutResult {
  nodes: Node<TaskNodeData>[];
  edges: Edge[];
}

/**
 * Computes a dagre-based DAG layout from a flat list of tasks.
 * Produces positioned React Flow nodes and edges for both hierarchy
 * (parent→child) and dependency relationships.
 */
export function useDagLayout(tasks: TaskData[]): DagLayoutResult {
  return useMemo(() => {
    if (tasks.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Enable multigraph so hierarchy and dependency edges between the same
    // pair of nodes are both preserved in the layout graph.
    const graph = new dagre.graphlib.Graph({ multigraph: true });
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({
      rankdir: "TB",
      nodesep: NODE_SEPARATION,
      ranksep: RANK_SEPARATION,
    });

    const taskById = new Map(tasks.map((t) => [t.id, t]));

    // Precompute children per parent to avoid O(n^2) lookups when building nodes.
    const childrenByParent = new Map<string, TaskData[]>();
    for (const task of tasks) {
      if (task.parentTaskId && taskById.has(task.parentTaskId)) {
        const siblings = childrenByParent.get(task.parentTaskId) || [];
        siblings.push(task);
        childrenByParent.set(task.parentTaskId, siblings);
      }
    }

    // Add nodes
    for (const task of tasks) {
      graph.setNode(task.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }

    // Add edges
    const edges: Edge[] = [];

    for (const task of tasks) {
      // Parent → child edges
      if (task.parentTaskId && taskById.has(task.parentTaskId)) {
        const edgeId = `hierarchy-${task.parentTaskId}-${task.id}`;
        graph.setEdge(task.parentTaskId, task.id, {}, edgeId);
        edges.push({
          id: edgeId,
          source: task.parentTaskId,
          target: task.id,
          type: "smoothstep",
          data: { edgeType: EDGE_TYPE_HIERARCHY },
          style: { stroke: "var(--accent-green)", strokeWidth: 2 },
          animated: false,
        });
      }

      // Dependency edges
      for (const depId of task.dependsOn) {
        if (taskById.has(depId)) {
          const edgeId = `dependency-${depId}-${task.id}`;
          graph.setEdge(depId, task.id, {}, edgeId);
          edges.push({
            id: edgeId,
            source: depId,
            target: task.id,
            type: "smoothstep",
            data: { edgeType: EDGE_TYPE_DEPENDENCY },
            style: {
              stroke: "var(--text-tertiary)",
              strokeWidth: 1.5,
              strokeDasharray: "6 3",
            },
            animated: false,
          });
        }
      }
    }

    // Run dagre layout
    dagre.layout(graph);

    // Map dagre positions to React Flow nodes
    const nodes: Node<TaskNodeData>[] = tasks.map((task) => {
      const nodeWithPosition = graph.node(task.id);
      const children = childrenByParent.get(task.id) || [];

      return {
        id: task.id,
        type: "task",
        position: {
          x: nodeWithPosition.x - NODE_WIDTH / 2,
          y: nodeWithPosition.y - NODE_HEIGHT / 2,
        },
        data: {
          task,
          childCount: children.length,
          doneChildCount: children.filter((c) => c.status === "done").length,
          hasDependencies: task.dependsOn.length > 0,
        },
      };
    });

    return { nodes, edges };
  }, [tasks]);
}
