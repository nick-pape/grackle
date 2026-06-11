import { type CSSProperties, type JSX } from "react";
import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { MAX_TASK_DEPTH, type MatchIndex } from "@grackle-ai/common";
import { ICON_SM } from "../../utils/iconSize.js";
import { taskUrl, newTaskUrl } from "../../utils/navigation.js";
import type { useAppNavigate } from "../../utils/navigation.js";
import { getStatusStyle, resolveStatus } from "../../utils/taskStatus.js";
import { Tooltip } from "../display/Tooltip.js";
import { HighlightedText, type TaskNode } from "./listHelpers.js";
import styles from "./TaskList.module.scss";

/** Base left-padding for task rows. */
const TASK_BASE_INDENT_PX: number = 16;
/** Additional left-padding per depth level. */
const TASK_DEPTH_INDENT_PX: number = 16;

/** Props for the recursive TaskTreeNode component. */
export interface TaskTreeNodeProps {
  /** The tree node to render. */
  node: TaskNode;
  /** Current nesting depth (0 = root). */
  depth: number;
  /** Set of task IDs that are currently expanded. */
  expandedTasks: Set<string>;
  /** Toggle expand/collapse for a task node. */
  toggleTask: (taskId: string) => void;
  /** ID of the currently selected task, if any. */
  selectedTaskId: string | undefined;
  /** Navigate function from useAppNavigate. */
  navigate: ReturnType<typeof useAppNavigate>;
  /** Status lookup by task ID, used for blocked-dependency detection. */
  taskStatusById: Map<string, string>;
  /** Per-task title highlight indices for matched search queries. */
  titleHighlights: Map<string, readonly MatchIndex[]>;
  /** Workspace name lookup by workspace ID. */
  workspaceNames: Map<string, string>;
}

/** Renders a single task tree node and recursively renders its expanded children. */
export function TaskTreeNode({
  node,
  depth,
  expandedTasks,
  toggleTask,
  selectedTaskId,
  navigate,
  taskStatusById,
  titleHighlights,
  workspaceNames,
}: TaskTreeNodeProps): JSX.Element {
  const statusStyle = getStatusStyle(node.status);
  const isBlocked =
    node.dependsOn.length > 0 &&
    node.dependsOn.some((depId) => taskStatusById.get(depId) !== "complete");
  const isExpanded = expandedTasks.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedTaskId === node.id;
  const indent = TASK_BASE_INDENT_PX + depth * TASK_DEPTH_INDENT_PX;
  const isRoot = depth === 0;
  const wsName =
    isRoot && !node.parentTaskId && node.workspaceId
      ? workspaceNames.get(node.workspaceId)
      : undefined;
  return (
    <>
      <div
        onClick={() => navigate(taskUrl(node.id))}
        role="button"
        tabIndex={0}
        aria-label={node.title}
        onKeyDown={(e) => {
          if (e.currentTarget === e.target && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            navigate(taskUrl(node.id));
          }
        }}
        className={`${styles.taskRow} ${isSelected ? styles.selected : ""}`}
        style={{ "--task-indent": `${indent}px` } as CSSProperties}
        data-task-id={node.id}
      >
        {hasChildren && (
          <span
            className={`${styles.expandArrow} ${isExpanded ? styles.expanded : ""}`}
            role="button"
            tabIndex={0}
            aria-label={isExpanded ? "Collapse task" : "Expand task"}
            onClick={(e) => {
              e.stopPropagation();
              toggleTask(node.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                toggleTask(node.id);
              }
            }}
          >
            <ChevronRight size={ICON_SM} aria-hidden="true" />
          </span>
        )}
        {!hasChildren && <span className={styles.leafSpacer} />}
        <span
          className={styles.taskStatusIcon}
          style={{ color: statusStyle.color }}
          aria-hidden="true"
          data-testid={`task-status-${resolveStatus(node.status)}`}
        >
          {statusStyle.icon}
        </span>
        <span className={styles.taskTitle} title={node.title}>
          <HighlightedText
            text={node.title}
            indices={titleHighlights.get(node.id)}
            highlightClass={styles.searchHighlight}
          />
        </span>
        {wsName && (
          <span className={styles.workspaceBadge} title={wsName}>
            {wsName}
          </span>
        )}
        {hasChildren && (
          <span className={styles.childCountBadge}>
            {node.children.filter((c) => c.status === "complete").length}/{node.children.length}
          </span>
        )}
        {node.dependsOn.length > 0 && (
          <span
            className={`${styles.dependencyBadge} ${isBlocked ? styles.blockedBadge : ""}`}
            title={`Depends on: ${node.dependsOn.join(", ")}`}
          >
            {isBlocked ? "blocked" : "dep"}
          </span>
        )}
        {depth < MAX_TASK_DEPTH && (
          <Tooltip text="Add child task">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(newTaskUrl(node.workspaceId, node.id));
              }}
              aria-label="Add child task"
              className={styles.addChildButton}
            >
              +
            </button>
          </Tooltip>
        )}
      </div>

      <AnimatePresence>
        {hasChildren && isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: "hidden" }}
          >
            {node.children.map((child) => (
              <TaskTreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                expandedTasks={expandedTasks}
                toggleTask={toggleTask}
                selectedTaskId={selectedTaskId}
                navigate={navigate}
                taskStatusById={taskStatusById}
                titleHighlights={titleHighlights}
                workspaceNames={workspaceNames}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
