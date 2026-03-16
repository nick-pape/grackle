import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { TaskNodeData } from "./useDagLayout.js";
import { getStatusStyle } from "../../utils/taskStatus.js";
import styles from "./DagView.module.scss";
import type { JSX } from "react";

/** Custom React Flow node component rendering a task as a glass card. */
export function TaskNode({ data }: NodeProps): JSX.Element {
  const { task, childCount, doneChildCount, hasDependencies } = data as TaskNodeData;
  const statusStyle = getStatusStyle(task.status);

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
