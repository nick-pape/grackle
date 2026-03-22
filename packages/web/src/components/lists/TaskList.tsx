import { useEffect, useMemo, useState, type CSSProperties, type JSX } from "react";
import { useMatch } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import { AnimatePresence, motion } from "motion/react";
import { MAX_TASK_DEPTH, fuzzySearch, type FuzzyKey, type MatchIndex } from "@grackle-ai/common";
import { taskUrl, newTaskUrl, useAppNavigate } from "../../utils/navigation.js";
import { getStatusStyle } from "../../utils/taskStatus.js";
import { HighlightedText, buildTaskTree, groupTasksByStatus, type TaskNode, type StatusGroup } from "./listHelpers.js";
import styles from "./TaskList.module.scss";

/** Fuzzy search keys for task matching. */
const TASK_SEARCH_KEYS: FuzzyKey[] = [{ name: "title", weight: 2 }, { name: "description", weight: 1 }];

/** Base left-padding for task rows. */
const TASK_BASE_INDENT_PX: number = 16;
/** Additional left-padding per depth level. */
const TASK_DEPTH_INDENT_PX: number = 16;

// ---------------------------------------------------------------------------
// Group-by-status toggle persistence
// ---------------------------------------------------------------------------

/** localStorage key for the group-by-status toggle (separate from WorkspaceList's
 *  "grackle-group-by-status" key — each view has its own grouping preference). */
const STORAGE_KEY_GROUP_BY_STATUS: string = "grackle-task-group-by-status";

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
  workspaceNames: Map<string, string>;

}

/** Collapsible accordion for a status group. */
function StatusGroupAccordion({
  group,
  isExpanded,
  onToggle,
  selectedTaskId,
  navigate,
  titleHighlights,
  workspaceNames,

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
              const wsName = task.parentTaskId || !task.workspaceId ? undefined : workspaceNames.get(task.workspaceId);
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
                    <HighlightedText text={task.title} indices={titleHighlights.get(task.id)} highlightClass={styles.searchHighlight} />
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
  workspaceNames: Map<string, string>;

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
  workspaceNames,

}: TaskTreeNodeProps): JSX.Element {
  const statusStyle = getStatusStyle(node.status);
  const isBlocked = node.dependsOn.length > 0 &&
    node.dependsOn.some((depId) => taskStatusById.get(depId) !== "complete");
  const isExpanded = expandedTasks.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedTaskId === node.id;
  const indent = TASK_BASE_INDENT_PX + depth * TASK_DEPTH_INDENT_PX;
  const isRoot = depth === 0;
  const wsName = isRoot && !node.parentTaskId && node.workspaceId ? workspaceNames.get(node.workspaceId) : undefined;
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
          <HighlightedText text={node.title} indices={titleHighlights.get(node.id)} highlightClass={styles.searchHighlight} />
        </span>
        {wsName && (
          <span className={styles.workspaceBadge} title={wsName}>{wsName}</span>
        )}
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
                workspaceNames={workspaceNames}
    
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

/** Global task tree sidebar view — shows all tasks across all workspaces. */
export function TaskList(): JSX.Element {
  const { workspaces, tasks } = useGrackle();
  const navigate = useAppNavigate();
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [manuallyCollapsed, setManuallyCollapsed] = useState<Set<string>>(new Set());
  const [groupByStatus, setGroupByStatusState] = useState(getGroupByStatus);
  const [groupExpandDefault, setGroupExpandDefault] = useState(getGroupByStatus);
  const [groupExpandOverrides, setGroupExpandOverrides] = useState<Map<string, boolean>>(new Map());

  // Derive selected state from router
  const taskMatch = useMatch("/tasks/:taskId/*");
  const selectedTaskId = taskMatch?.params.taskId !== "new" ? taskMatch?.params.taskId : undefined;

  const taskStatusById = useMemo(
    () => new Map(tasks.map((t) => [t.id, t.status])),
    [tasks],
  );

  const workspaceNames = useMemo(
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

  // ── Search / filter state ──────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");

  const { directMatchTaskIds, treeMatchTaskIds, titleHighlights } = useMemo(() => {
    if (!searchQuery.trim()) {
      return { directMatchTaskIds: null, treeMatchTaskIds: null, titleHighlights: new Map<string, readonly MatchIndex[]>() };
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

    // Include ancestor tasks for tree structure
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

  const isSearching = directMatchTaskIds !== null;
  const activeMatchIds = isSearching
    ? (groupByStatus ? directMatchTaskIds : treeMatchTaskIds)
    : null;
  const visibleTasks = activeMatchIds
    ? tasks.filter((t) => activeMatchIds.has(t.id))
    : tasks;

  const tree = !groupByStatus ? buildTaskTree(visibleTasks) : [];

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
            data-testid="task-group-by-status-toggle"
          >
            {"\u2261"}
          </button>
          <button
            className={styles.addButton}
            onClick={() => navigate(newTaskUrl())}
            aria-label="New task"
            title="New task"
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

      {groupByStatus ? (
        groupTasksByStatus(visibleTasks, taskStatusById).map(group => (
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
            workspaceNames={workspaceNames}

          />
        ))
      )}

      {visibleTasks.length === 0 && !isSearching && (
        <div className={styles.emptyState}>
          No tasks yet. Click + to create one.
        </div>
      )}
      {visibleTasks.length === 0 && isSearching && (
        <div className={styles.emptyState}>
          No matching tasks
        </div>
      )}
    </div>
  );
}
