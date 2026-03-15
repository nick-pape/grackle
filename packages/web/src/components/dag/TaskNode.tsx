import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { TaskNodeData } from "./useDagLayout.js";
import styles from "./DagView.module.scss";
import type { JSX } from "react";

/** Task status visual indicators using CSS custom property colors. */
const TASK_STATUS_STYLES: Record<string, { color: string; icon: string }> = {
  not_started: { color: "var(--text-tertiary)", icon: "\u25CB" },
  working: { color: "var(--accent-green)", icon: "\u25CF" },
  paused: { color: "var(--accent-yellow)", icon: "\u25C9" },
  complete: { color: "var(--accent-green)", icon: "\u2713" },
  failed: { color: "var(--accent-red)", icon: "\u2717" },
};

/** Custom React Flow node component rendering a task as a glass card. */
export function TaskNode({ data }: NodeProps): JSX.Element {
  const { task, childCount, doneChildCount, hasDependencies } = data as TaskNodeData;
  const statusStyle = TASK_STATUS_STYLES[task.status];

  return (
    <div className={styles.taskNode} data-task-id={task.id} data-task-title={task.title}>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <div className={styles.taskNodeBorder} style={{ backgroundColor: statusStyle.color }} />
      <div className={styles.taskNodeContent}>
        <div className={styles.taskNodeHeader}>
          <span className={styles.taskNodeIcon} style={{ color: statusStyle.color }}>
            {statusStyle.icon}
          </span>
          <span className={styles.taskNodeTitle}>
            {task.title}
          </span>
        </div>
        <div className={styles.taskNodeBadges}>
          {childCount > 0 && (
            <span className={styles.childBadge}>
              {doneChildCount}/{childCount}
            </span>
          )}
          {hasDependencies && (
            <span className={styles.depBadge}>dep</span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}
