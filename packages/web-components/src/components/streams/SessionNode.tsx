import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { JSX } from "react";
import { sessionStatusStyle } from "../../utils/sessionStatus.js";
import type { SessionNodeData } from "./useCoordinationLayout.js";
import styles from "./CoordinationGraph.module.scss";

/**
 * Custom React Flow node rendering an agent session as a status-colored card.
 * Used by {@link CoordinationGraph}; handles flow left (target) to right (source)
 * to match the bipartite LR layout.
 */
export function SessionNode({ data }: NodeProps): JSX.Element {
  const { session, streamCount, external } = data as SessionNodeData;
  const status = sessionStatusStyle(session.status, external);
  const color = `var(${status.varName})`;
  const className = external ? `${styles.sessionNode} ${styles.external}` : styles.sessionNode;

  return (
    <div className={className} data-testid={`coordination-node-session-${session.id}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.sessionAccent} style={{ backgroundColor: color }} />
      <div className={styles.nodeContent}>
        <div className={styles.nodeHeader}>
          <span className={styles.nodeTitle}>{external ? session.id : session.runtime}</span>
        </div>
        <div className={styles.nodeMeta}>
          <span className={styles.nodeSubtle} style={{ color }}>{status.label}</span>
          {streamCount > 0 && <span className={styles.countBadge}>{streamCount}</span>}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}
