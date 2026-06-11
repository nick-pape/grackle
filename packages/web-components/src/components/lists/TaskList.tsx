import { useEffect, useMemo, useState, type JSX } from "react";
import { List } from "lucide-react";
import { useMatch } from "react-router";
import type { Workspace, TaskData } from "../../hooks/types.js";
import { ICON_MD } from "../../utils/iconSize.js";
import { newTaskUrl, useAppNavigate } from "../../utils/navigation.js";
import { SectionHeader, type SectionHeaderAction } from "../display/SectionHeader.js";
import { buildTaskTree, groupTasksByStatus } from "./listHelpers.js";
import { StatusGroupAccordion } from "./StatusGroupAccordion.js";
import { TaskTreeNode } from "./TaskTreeNode.js";
import { useGroupByStatus } from "./useGroupByStatus.js";
import { useTaskSearch } from "./useTaskSearch.js";
import styles from "./TaskList.module.scss";

/** Props for the TaskList component. */
interface TaskListProps {
  /** All workspaces (used for workspace name lookup). */
  workspaces: Workspace[];
  /** All tasks to display. */
  tasks: TaskData[];
}

/** Global task tree sidebar view — shows all tasks across all workspaces. */
export function TaskList({ workspaces, tasks }: TaskListProps): JSX.Element {
  const navigate = useAppNavigate();
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [manuallyCollapsed, setManuallyCollapsed] = useState<Set<string>>(new Set());

  const { groupByStatus, toggleGroupByStatus, isGroupExpanded, toggleStatusGroup } =
    useGroupByStatus();
  const {
    searchQuery,
    setSearchQuery,
    directMatchTaskIds,
    treeMatchTaskIds,
    titleHighlights,
    isSearching,
  } = useTaskSearch(tasks);

  // Derive selected state from router
  const taskMatch = useMatch("/tasks/:taskId/*");
  const selectedTaskId = taskMatch?.params.taskId !== "new" ? taskMatch?.params.taskId : undefined;

  const taskStatusById = useMemo(() => new Map(tasks.map((t) => [t.id, t.status])), [tasks]);

  const workspaceNames = useMemo(
    () => new Map(workspaces.map((w) => [w.id, w.name])),
    [workspaces],
  );

  const toggleTask = (tid: string): void => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(tid)) {
        next.delete(tid);
        setManuallyCollapsed((mc) => new Set(mc).add(tid));
      } else {
        next.add(tid);
        setManuallyCollapsed((mc) => {
          const updated = new Set(mc);
          updated.delete(tid);
          return updated;
        });
      }
      return next;
    });
  };

  // Auto-expand parent tasks that have children (skip manually collapsed ones)
  useEffect(() => {
    const parentIds = new Set(tasks.filter((t) => t.parentTaskId).map((t) => t.parentTaskId));
    if (parentIds.size > 0) {
      setExpandedTasks((prev) => {
        const next = new Set(prev);
        for (const pid of parentIds) {
          if (!manuallyCollapsed.has(pid)) {
            next.add(pid);
          }
        }
        return next;
      });
    }
  }, [tasks, manuallyCollapsed]);

  // Resolve which tasks are visible given the current search and grouping mode
  const activeMatchIds = isSearching
    ? groupByStatus
      ? directMatchTaskIds
      : treeMatchTaskIds
    : undefined;
  const visibleTasks = activeMatchIds ? tasks.filter((t) => activeMatchIds.has(t.id)) : tasks;

  const tree = !groupByStatus ? buildTaskTree(visibleTasks) : [];

  const headerActions = useMemo<SectionHeaderAction[]>(
    () => [
      {
        key: "group",
        icon: <List size={ICON_MD} />,
        tooltip: groupByStatus ? "Switch to tree view" : "Group tasks by status",
        ariaLabel: groupByStatus ? "Switch to tree view" : "Group tasks by status",
        onClick: toggleGroupByStatus,
        active: groupByStatus,
        ariaPressed: groupByStatus,
        testId: "task-group-by-status-toggle",
      },
      {
        key: "add",
        icon: <span>+</span>,
        tooltip: "New task",
        ariaLabel: "New task",
        onClick: () => navigate(newTaskUrl()),
        testId: "new-task-button",
      },
    ],
    [groupByStatus, toggleGroupByStatus, navigate],
  );

  return (
    <div className={styles.container}>
      <SectionHeader title="Tasks" actions={headerActions} data-testid="task-list-header" />

      {tasks.length > 0 && (
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter..."
          aria-label="Filter tasks"
          className={styles.searchInput}
          data-testid="sidebar-search"
        />
      )}

      {groupByStatus
        ? groupTasksByStatus(visibleTasks, taskStatusById).map((group) => (
            <StatusGroupAccordion
              key={group.status}
              group={group}
              isExpanded={isGroupExpanded(group.status)}
              onToggle={() => toggleStatusGroup(group.status)}
              selectedTaskId={selectedTaskId}
              navigate={navigate}
              titleHighlights={titleHighlights}
              workspaceNames={workspaceNames}
            />
          ))
        : tree.map((node) => (
            <TaskTreeNode
              key={node.id}
              node={node}
              depth={0}
              expandedTasks={expandedTasks}
              toggleTask={toggleTask}
              selectedTaskId={selectedTaskId}
              navigate={navigate}
              taskStatusById={taskStatusById}
              titleHighlights={titleHighlights}
              workspaceNames={workspaceNames}
            />
          ))}

      {visibleTasks.length === 0 && !isSearching && (
        <div className={styles.emptyState}>No tasks yet. Click + to create one.</div>
      )}
      {visibleTasks.length === 0 && isSearching && (
        <div className={styles.emptyState}>No matching tasks</div>
      )}
    </div>
  );
}
