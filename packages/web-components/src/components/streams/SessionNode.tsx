import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { JSX } from "react";
import type { SessionNodeData } from "./useCoordinationLayout.js";
import styles from "./CoordinationGraph.module.scss";

/** Capitalize the first letter of a status string for display. */
function capitalize(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * Color + label for a session node. Sessions use a different status vocabulary
 * than tasks (running / stopped / suspended / idle / hibernating / ...), so this
 * maps them directly rather than reusing the task-status helper.
 */
function sessionStatusStyle(status: string, external: boolean): { color: string; label: string } {
  if (external) {
    return { color: "var(--text-tertiary)", label: "external" };
  }
  switch (status) {
    case "running":
      return { color: "var(--accent-green)", label: "Running" };
    case "idle":
    case "suspended":
    case "hibernating":
      return { color: "var(--accent-yellow)", label: capitalize(status) };
    case "failed":
    case "interrupted":
      return { color: "var(--accent-red)", label: capitalize(status) };
    default:
      // stopped, completed, unknown, etc.
      return { color: "var(--text-tertiary)", label: status.length > 0 ? capitalize(status) : "Unknown" };
  }
}

/**
 * Custom React Flow node rendering an agent session as a status-colored card.
 * Used by {@link CoordinationGraph}; handles flow left (target) to right (source)
 * to match the bipartite LR layout.
 */
export function SessionNode({ data }: NodeProps): JSX.Element {
  const { session, streamCount, external } = data as SessionNodeData;
  const status = sessionStatusStyle(session.status, external);
  const className = external ? `${styles.sessionNode} ${styles.external}` : styles.sessionNode;

  return (
    <div className={className} data-testid={`coordination-node-session-${session.id}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.sessionAccent} style={{ backgroundColor: status.color }} />
      <div className={styles.nodeContent}>
        <div className={styles.nodeHeader}>
          <span className={styles.nodeTitle}>{external ? session.id : session.runtime}</span>
        </div>
        <div className={styles.nodeMeta}>
          <span className={styles.nodeSubtle} style={{ color: status.color }}>{status.label}</span>
          {streamCount > 0 && <span className={styles.countBadge}>{streamCount}</span>}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}
