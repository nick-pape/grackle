/**
 * Global sidebar task list with tree and status-grouped views.
 *
 * @module
 */

import { useEffect, useMemo, useState, type CSSProperties, type JSX } from "react";
import { useMatch } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import type { TaskData } from "../../hooks/useGrackleSocket.js";
import { AnimatePresence, motion } from "motion/react";
import { MAX_TASK_DEPTH, fuzzySearch, type FuzzyKey, type MatchIndex } from "@grackle-ai/common";
import { taskUrl, newTaskUrl, useAppNavigate } from "../../utils/navigation.js";
import { SIDEBAR_STATUS_ORDER, getStatusStyle } from "../../utils/taskStatus.js";
import styles from "./TaskList.module.scss";

// ---------------------------------------------------------------------------
// Text highlighting helpers
// ---------------------------------------------------------------------------

/** Merge overlapping or adjacent [start, end] ranges into non-overlapping ranges. */
function mergeRanges(ranges: readonly MatchIndex[]): MatchIndex[] {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const [start, end] = sorted[i];
    if (start <= prev[1] + 1) {
      prev[1] = Math.max(prev[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/** Render text with highlighted match ranges. Unmatched portions are plain, matched portions are bold. */
function HighlightedText({ text, indices }: { text: string; indices?: readonly MatchIndex[] }): JSX.Element {
  if (!indices || indices.length === 0) {
    return <>{text}</>;
  }
  const merged = mergeRanges(indices);
  const parts: JSX.Element[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      parts.push(<span key={`p${cursor}`}>{text.slice(cursor, start)}</span>);
    }
    parts.push(<mark key={`m${start}`} className={styles.searchHighlight}>{text.slice(start, end + 1)}</mark>);
    cursor = end + 1;
  }
  if (cursor < text.length) {
    parts.push(<span key={`p${cursor}`}>{text.slice(cursor)}</span>);
  }
  return <>{parts}</>;
}

// ---------------------------------------------------------------------------
// Search keys
// ---------------------------------------------------------------------------

/** Fuzzy search keys for task matching. */
const TASK_SEARCH_KEYS: FuzzyKey[] = [{ name: "title", weight: 2 }, { name: "description", weight: 1 }];

// ---------------------------------------------------------------------------
// Indent constants
// ---------------------------------------------------------------------------

/** Base left-padding for task rows (no workspace layer, so start shallower). */
const TASK_BASE_INDENT_PX: number = 16;
/** Additional left-padding per depth level. */
const TASK_DEPTH_INDENT_PX: number = 16;

// ---------------------------------------------------------------------------
// Group-by-status toggle persistence
// ---------------------------------------------------------------------------

/** localStorage key for the group-by-status toggle. */
const STORAGE_KEY_GROUP_BY_STATUS: string = "grackle-group-by-status";

/** Read the persisted group-by-status preference. */
function getGroupByStatus(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_GROUP_BY_STATUS) === "true";
  } catch {
    return false;
  }
}

/** Persist the group-by-status preference. */
function saveGroupByStatus(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_GROUP_BY_STATUS, String(value));
  } catch {
    /* localStorage unavailable */
  }
}

// ---------------------------------------------------------------------------
// Status grouping
// ---------------------------------------------------------------------------

/** A group of tasks sharing the same status. */
interface StatusGroup {
  status: string;
  label: string;
  style: { color: string; icon: string };
  tasks: TaskData[];
}

/** Group a flat list of tasks by status, ordered by urgency. Blocked tasks are separated into their own group. */
function groupTasksByStatus(taskList: TaskData[], taskStatusById: Map<string, string>): StatusGroup[] {
  const byStatus = new Map<string, TaskData[]>();
  for (const task of taskList) {
    const isBlocked = task.dependsOn.length > 0 &&
      task.dependsOn.some((depId) => taskStatusById.get(depId) !== "complete");
    const groupKey = isBlocked ? "blocked" : task.status;
    const list = byStatus.get(groupKey);
    if (list) {
      list.push(task);
    } else {
      byStatus.set(groupKey, [task]);
    }
  }

  const groups: StatusGroup[] = [];
  const seen = new Set<string>();

  for (const status of SIDEBAR_STATUS_ORDER) {
    seen.add(status);
    const tasks = byStatus.get(status);
    if (tasks && tasks.length > 0) {
      tasks.sort((a, b) => a.sortOrder - b.sortOrder);
      const style = getStatusStyle(status);
      groups.push({ status, label: style.label, style, tasks });
    }
  }

  for (const [status, tasks] of byStatus) {
    if (!seen.has(status) && tasks.length > 0) {
      tasks.sort((a, b) => a.sortOrder - b.sortOrder);
      const style = getStatusStyle(status);
      groups.push({ status, label: style.label, style, tasks });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// StatusGroupAccordion
// ---------------------------------------------------------------------------

/** Props for the StatusGroupAccordion component. */
interface StatusGroupAccordionProps {
  group: StatusGroup;
  isExpanded: boolean;
  onToggle: () => void;
  selectedTaskId: string | undefined;
  navigate: ReturnType<typeof useAppNavigate>;
  titleHighlights: Map<string, readonly MatchIndex[]>;
  workspacesById: Map<string, string>;
}

/** Collapsible accordion for a status group in grouped view. */
function StatusGroupAccordion({
  group,
  isExpanded,
  onToggle,
  selectedTaskId,
  navigate,
  titleHighlights,
  workspacesById,
}: StatusGroupAccordionProps): JSX.Element {
  return (
    <div data-testid={`status-group-${group.status}`}>
      <div
        className={styles.statusGroupHeader}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className={`${styles.expandArrow} ${isExpanded ? styles.expanded : ""}`}>
          {"\u25B8"}
        </span>
        <span className={styles.statusGroupIcon} style={{ color: group.style.color }}>
          {group.style.icon}
        </span>
        <span className={styles.statusGroupLabel}>{group.label}</span>
        <span className={styles.statusGroupCount}>{group.tasks.length}</span>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            {group.tasks.map((task) => {
              const statusStyle = getStatusStyle(task.status);
              const isSelected = selectedTaskId === task.id;
              const wsName = workspacesById.get(task.workspaceId);
              return (
                <div
                  key={task.id}
                  onClick={() => navigate(taskUrl(task.id))}
                  className={`${styles.taskRow} ${isSelected ? styles.selected : ""}`}
                  style={{ '--task-indent': `${TASK_BASE_INDENT_PX}px` } as CSSProperties}
                  data-task-id={task.id}
                >
                  <span className={styles.leafSpacer} />
                  <span className={styles.taskStatusIcon} style={{ color: statusStyle.color }}>
                    {statusStyle.icon}
                  </span>
                  <span className={styles.taskTitle} title={task.title}>
                    <HighlightedText text={task.title} indices={titleHighlights.get(task.id)} />
                  </span>
                  {wsName && (
                    <span className={styles.workspaceBadge} title={wsName}>{wsName}</span>
                  )}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task tree
// ---------------------------------------------------------------------------

/** A task node with children for recursive tree rendering. */
interface TaskNode extends TaskData {
  children: TaskNode[];
}

/** Assemble flat TaskData[] into a tree. */
function buildTaskTree(taskList: TaskData[]): TaskNode[] {
  const byId = new Map<string, TaskNode>(
    taskList.map(t => [t.id, { ...t, children: [] }]),
  );
  const roots: TaskNode[] = [];
  for (const node of byId.values()) {
    if (node.parentTaskId && byId.has(node.parentTaskId)) {
      byId.get(node.parentTaskId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  for (const node of byId.values()) {
    node.children.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return roots.sort((a, b) => a.sortOrder - b.sortOrder);
}

// ---------------------------------------------------------------------------
// TaskTreeNode
// ---------------------------------------------------------------------------

/** Props for the recursive TaskTreeNode component. */
interface TaskTreeNodeProps {
  node: TaskNode;
  depth: number;
  expandedTasks: Set<string>;
  toggleTask: (taskId: string) => void;
  selectedTaskId: string | undefined;
  navigate: ReturnType<typeof useAppNavigate>;
  taskStatusById: Map<string, string>;
  titleHighlights: Map<string, readonly MatchIndex[]>;
  workspacesById: Map<string, string>;
  isRoot: boolean;
}

/** Renders a single task tree node with optional children. */
function TaskTreeNode({
  node,
  depth,
  expandedTasks,
  toggleTask,
  selectedTaskId,
  navigate,
  taskStatusById,
  titleHighlights,
  workspacesById,
  isRoot,
}: TaskTreeNodeProps): JSX.Element {
  const statusStyle = getStatusStyle(node.status);
  const isBlocked = node.dependsOn.length > 0 &&
    node.dependsOn.some((depId) => taskStatusById.get(depId) !== "complete");
  const isExpanded = expandedTasks.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedTaskId === node.id;
  const indent = TASK_BASE_INDENT_PX + depth * TASK_DEPTH_INDENT_PX;
  const wsName = isRoot ? workspacesById.get(node.workspaceId) : undefined;

  return (
    <>
      <div
        onClick={() => navigate(taskUrl(node.id))}
        className={`${styles.taskRow} ${isSelected ? styles.selected : ""}`}
        style={{ '--task-indent': `${indent}px` } as CSSProperties}
        data-task-id={node.id}
      >
        {hasChildren && (
          <span
            className={`${styles.expandArrow} ${isExpanded ? styles.expanded : ""}`}
            role="button"
            tabIndex={0}
            aria-label={isExpanded ? "Collapse task" : "Expand task"}
            onClick={(e) => { e.stopPropagation(); toggleTask(node.id); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                toggleTask(node.id);
              }
            }}
          >
            {"\u25B8"}
          </span>
        )}
        {!hasChildren && <span className={styles.leafSpacer} />}
        <span className={styles.taskStatusIcon} style={{ color: statusStyle.color }}>
          {statusStyle.icon}
        </span>
        <span className={styles.taskTitle} title={node.title}>
          <HighlightedText text={node.title} indices={titleHighlights.get(node.id)} />
        </span>
        {hasChildren && (
          <span className={styles.childCountBadge}>
            {node.children.filter(c => c.status === "complete").length}/{node.children.length}
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
        {wsName && (
          <span className={styles.workspaceBadge} title={wsName}>{wsName}</span>
        )}
        {depth < MAX_TASK_DEPTH && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(newTaskUrl(node.workspaceId, node.id));
            }}
            title="Add child task"
            aria-label="Add child task"
            className={styles.addChildButton}
          >
            +
          </button>
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
            {node.children.map(child => (
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
                workspacesById={workspacesById}
                isRoot={false}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ---------------------------------------------------------------------------
// TaskList (main export)
// ---------------------------------------------------------------------------

/** Global sidebar task list with tree and status-grouped views. */
export function TaskList(): JSX.Element {
  const { tasks, workspaces } = useGrackle();
  const navigate = useAppNavigate();

  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [manuallyCollapsed, setManuallyCollapsed] = useState<Set<string>>(new Set());
  const [groupByStatus, setGroupByStatusState] = useState(getGroupByStatus);
  const [groupExpandDefault, setGroupExpandDefault] = useState(getGroupByStatus);
  const [groupExpandOverrides, setGroupExpandOverrides] = useState<Map<string, boolean>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");

  // Derive selected state from router
  const taskMatch = useMatch("/tasks/:taskId/*");
  const selectedTaskId = taskMatch?.params.taskId !== "new" ? taskMatch?.params.taskId : undefined;

  const taskStatusById = useMemo(
    () => new Map(tasks.map((t) => [t.id, t.status])),
    [tasks],
  );

  /** Map from workspace ID to workspace name for badge display. */
  const workspacesById = useMemo(
    () => new Map(workspaces.map((w) => [w.id, w.name])),
    [workspaces],
  );

  /** Toggle group-by-status mode. */
  const toggleGroupByStatus = (): void => {
    const next = !groupByStatus;
    saveGroupByStatus(next);
    setGroupByStatusState(next);
    if (next) {
      setGroupExpandDefault(true);
      setGroupExpandOverrides(new Map());
    }
  };

  /** Toggle a single status group accordion. */
  const toggleStatusGroup = (status: string): void => {
    setGroupExpandOverrides((prev) => {
      const next = new Map(prev);
      const current = next.has(status) ? next.get(status)! : groupExpandDefault;
      next.set(status, !current);
      return next;
    });
  };

  /** Check if a status group is expanded. */
  const isGroupExpanded = (status: string): boolean => {
    return groupExpandOverrides.has(status) ? groupExpandOverrides.get(status)! : groupExpandDefault;
  };

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
    const parentIds = new Set(
      tasks.filter(t => t.parentTaskId).map(t => t.parentTaskId),
    );
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

  // Fuzzy search filtering
  const { directMatchTaskIds, treeMatchTaskIds, titleHighlights } = useMemo(() => {
    if (!searchQuery.trim()) {
      return {
        directMatchTaskIds: null,
        treeMatchTaskIds: null,
        titleHighlights: new Map<string, readonly MatchIndex[]>(),
      };
    }
    const taskResults = fuzzySearch(tasks, searchQuery, TASK_SEARCH_KEYS);
    const directIds = new Set(taskResults.map((r) => r.item.id));

    const highlights = new Map<string, readonly MatchIndex[]>();
    for (const r of taskResults) {
      const titleMatch = r.matches.find((m) => m.key === "title");
      if (titleMatch) {
        highlights.set(r.item.id, titleMatch.indices);
      }
    }

    // Include ancestor tasks to preserve tree structure
    const treeIds = new Set(directIds);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    for (const taskId of [...directIds]) {
      let current = taskById.get(taskId);
      while (current?.parentTaskId) {
        treeIds.add(current.parentTaskId);
        current = taskById.get(current.parentTaskId);
      }
    }

    return { directMatchTaskIds: directIds, treeMatchTaskIds: treeIds, titleHighlights: highlights };
  }, [searchQuery, tasks]);

  // Filter tasks based on search
  const isSearching = directMatchTaskIds !== null;
  const activeMatchIds = isSearching
    ? (groupByStatus ? directMatchTaskIds : treeMatchTaskIds)
    : null;
  const filteredTasks = activeMatchIds
    ? tasks.filter((t) => activeMatchIds.has(t.id))
    : tasks;

  const tree = !groupByStatus ? buildTaskTree(filteredTasks) : [];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span>Tasks</span>
        <div className={styles.headerActions}>
          <button
            className={`${styles.groupToggle} ${groupByStatus ? styles.groupToggleActive : ""}`}
            onClick={toggleGroupByStatus}
            aria-label={groupByStatus ? "Switch to tree view" : "Group tasks by status"}
            aria-pressed={groupByStatus}
            title={groupByStatus ? "Switch to tree view" : "Group tasks by status"}
            data-testid="group-by-status-toggle"
          >
            {"\u2261"}
          </button>
          <button
            className={styles.addButton}
            onClick={() => navigate("/tasks/new")}
            aria-label="Create task"
            title="Create task"
            data-testid="new-task-button"
          >
            +
          </button>
        </div>
      </div>

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

      {tasks.length === 0 && (
        <div className={styles.emptyCta}>
          <button
            className={styles.ctaButton}
            onClick={() => navigate("/tasks/new")}
          >
            Create Task
          </button>
          <div className={styles.ctaDescription}>
            Create a task to get started
          </div>
        </div>
      )}

      {groupByStatus ? (
        groupTasksByStatus(filteredTasks, taskStatusById).map(group => (
          <StatusGroupAccordion
            key={group.status}
            group={group}
            isExpanded={isGroupExpanded(group.status)}
            onToggle={() => toggleStatusGroup(group.status)}
            selectedTaskId={selectedTaskId}
            navigate={navigate}
            titleHighlights={titleHighlights}
            workspacesById={workspacesById}
          />
        ))
      ) : (
        tree.map(node => (
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
            workspacesById={workspacesById}
            isRoot={true}
          />
        ))
      )}
    </div>
  );
}
