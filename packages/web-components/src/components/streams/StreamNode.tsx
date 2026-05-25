import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { JSX } from "react";
import type { StreamNodeData } from "./useCoordinationLayout.js";
import styles from "./CoordinationGraph.module.scss";

/**
 * Custom React Flow node rendering an IPC stream hub (chatroom, channel, or a
 * non-collapsible pipe). Chatrooms get a halo; non-task-owned hubs render
 * dimmed/haloless. Clicking the node selects the stream (opens its detail panel)
 * via {@link CoordinationGraph}.
 */
export function StreamNode({ data, selected }: NodeProps): JSX.Element {
  const { stream, streamKind, ownership } = data as StreamNodeData;
  const kindClass = streamKind === "chatroom" ? styles.chatroom : streamKind === "pipe" ? styles.pipe : styles.channel;
  const classNames = [styles.streamNode, kindClass];
  if (ownership.kind !== "task") {
    classNames.push(styles.haloless);
  }
  if (selected) {
    classNames.push(styles.selected);
  }

  return (
    <div className={classNames.join(" ")} data-testid={`coordination-node-stream-${stream.id}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.nodeContent}>
        <div className={styles.nodeHeader}>
          <span className={styles.kindBadge}>{streamKind}</span>
        </div>
        <span className={styles.nodeTitle}>{stream.name}</span>
        <span className={styles.nodeSubtle}>
          {stream.subscriberCount} {stream.subscriberCount === 1 ? "subscriber" : "subscribers"}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}
