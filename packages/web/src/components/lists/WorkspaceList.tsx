import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import { useMatch } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import { AnimatePresence, motion } from "motion/react";
import { MAX_TASK_DEPTH, fuzzySearch, type FuzzyKey, type MatchIndex } from "@grackle-ai/common";
import { Spinner } from "../display/index.js";
import { taskUrl, workspaceUrl, newTaskUrl, useAppNavigate } from "../../utils/navigation.js";
import { getStatusStyle } from "../../utils/taskStatus.js";
import { mergeRanges, buildTaskTree, groupTasksByStatus, type TaskNode, type StatusGroup } from "./listHelpers.js";
import styles from "./WorkspaceList.module.scss";

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

/** Fuzzy search keys for workspace matching. */
const WORKSPACE_SEARCH_KEYS: FuzzyKey[] = [{ name: "name", weight: 2 }, { name: "description", weight: 1 }];
/** Fuzzy search keys for task matching. */
const TASK_SEARCH_KEYS: FuzzyKey[] = [{ name: "title", weight: 2 }, { name: "description", weight: 1 }];

/** Base left-padding for task rows inside a workspace. */
const TASK_BASE_INDENT_PX: number = 34;
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
}

/** Collapsible accordion for a status group in grouped view. */
function StatusGroupAccordion({
  group,
  isExpanded,
  onToggle,
  selectedTaskId,
  navigate,
  titleHighlights,
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
  workspaceId: string;
  taskStatusById: Map<string, string>;
  titleHighlights: Map<string, readonly MatchIndex[]>;
}

/** Renders a single task tree node with optional children. */
function TaskTreeNode({
  node,
  depth,
  expandedTasks,
  toggleTask,
  selectedTaskId,
  navigate,
  workspaceId,
  taskStatusById,
  titleHighlights,
}: TaskTreeNodeProps): JSX.Element {
  const statusStyle = getStatusStyle(node.status);
  const isBlocked = node.dependsOn.length > 0 &&
    node.dependsOn.some((depId) => taskStatusById.get(depId) !== "complete");
  const isExpanded = expandedTasks.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedTaskId === node.id;
  const indent = TASK_BASE_INDENT_PX + depth * TASK_DEPTH_INDENT_PX;

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
        {depth < MAX_TASK_DEPTH && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(newTaskUrl(workspaceId, node.id));
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
                workspaceId={workspaceId}
                taskStatusById={taskStatusById}
                titleHighlights={titleHighlights}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Sidebar workspace tree with expandable task lists and hierarchical task rendering. */
export function WorkspaceList(): JSX.Element {
  const { workspaces, tasks, environments, loadTasks, createWorkspace, workspaceCreating } = useGrackle();
  const navigate = useAppNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [manuallyCollapsed, setManuallyCollapsed] = useState<Set<string>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [groupByStatus, setGroupByStatusState] = useState(getGroupByStatus);
  // Track which groups should default to expanded (resets on each toggle-on)
  const [groupExpandDefault, setGroupExpandDefault] = useState(getGroupByStatus);
  // Per-workspace overrides: "workspaceId:status" → explicitly collapsed or expanded
  const [groupExpandOverrides, setGroupExpandOverrides] = useState<Map<string, boolean>>(new Map());

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

  /** Toggle a single status group accordion for a specific workspace. */
  const toggleStatusGroup = (workspaceId: string, status: string): void => {
    const key = `${workspaceId}:${status}`;
    setGroupExpandOverrides((prev) => {
      const next = new Map(prev);
      const current = next.has(key) ? next.get(key)! : groupExpandDefault;
      next.set(key, !current);
      return next;
    });
  };

  /** Check if a status group is expanded for a specific workspace. */
  const isGroupExpanded = (workspaceId: string, status: string): boolean => {
    const key = `${workspaceId}:${status}`;
    return groupExpandOverrides.has(key) ? groupExpandOverrides.get(key)! : groupExpandDefault;
  };

  // Derive selected state from router
  const taskMatch = useMatch("/tasks/:taskId/*");
  const workspaceMatch = useMatch("/workspaces/:workspaceId");
  const selectedTaskId = taskMatch?.params.taskId !== "new" ? taskMatch?.params.taskId : undefined;
  const selectedWorkspaceId = workspaceMatch?.params.workspaceId;

  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const taskStatusById = useMemo(
    () => new Map(tasks.map((t) => [t.id, t.status])),
    [tasks],
  );

  const toggleExpand = (pid: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
        loadTasks(pid);
      }
      return next;
    });
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

  // Auto-expand a workspace when selected via programmatic navigation
  useEffect(() => {
    if (selectedWorkspaceId && !expandedRef.current.has(selectedWorkspaceId)) {
      setExpanded((prev) => new Set(prev).add(selectedWorkspaceId));
      loadTasks(selectedWorkspaceId);
    }
  }, [selectedWorkspaceId, loadTasks]);

  const handleCreateWorkspace = (): void => {
    if (!newWorkspaceName.trim() || workspaceCreating || environments.length === 0) {
      return;
    }
    createWorkspace(newWorkspaceName.trim(), undefined, undefined, environments[0].id);
    setNewWorkspaceName("");
    setShowCreateForm(false);
  };

  // ── Search / filter state ──────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");

  /** Sets of matching IDs for filtering, recomputed when query or data changes. */
  const { directMatchTaskIds, treeMatchTaskIds, visibleWorkspaceIds, matchedWorkspaceIds, titleHighlights } = useMemo(() => {
    if (!searchQuery.trim()) {
      return { directMatchTaskIds: null, treeMatchTaskIds: null, visibleWorkspaceIds: null, matchedWorkspaceIds: null, titleHighlights: new Map<string, readonly MatchIndex[]>() };
    }
    const workspaceResults = fuzzySearch(workspaces, searchQuery, WORKSPACE_SEARCH_KEYS);
    const taskResults = fuzzySearch(tasks, searchQuery, TASK_SEARCH_KEYS);

    const mWorkspaceIds = new Set(workspaceResults.map((r) => r.item.id));
    const directIds = new Set(taskResults.map((r) => r.item.id));

    // Build highlight map: task ID → match indices for the "title" field
    const highlights = new Map<string, readonly MatchIndex[]>();
    for (const r of taskResults) {
      const titleMatch = r.matches.find((m) => m.key === "title");
      if (titleMatch) {
        highlights.set(r.item.id, titleMatch.indices);
      }
    }

    // A workspace is visible if it matches directly or any of its tasks match
    const vWorkspaceIds = new Set(mWorkspaceIds);
    for (const r of taskResults) {
      if (r.item.workspaceId) {
        vWorkspaceIds.add(r.item.workspaceId);
      }
    }

    // For tree view, also include ancestor tasks to preserve tree structure
    const treeIds = new Set(directIds);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    for (const taskId of [...directIds]) {
      let current = taskById.get(taskId);
      while (current?.parentTaskId) {
        treeIds.add(current.parentTaskId);
        current = taskById.get(current.parentTaskId);
      }
    }

    return { directMatchTaskIds: directIds, treeMatchTaskIds: treeIds, visibleWorkspaceIds: vWorkspaceIds, matchedWorkspaceIds: mWorkspaceIds, titleHighlights: highlights };
  }, [searchQuery, workspaces, tasks]);

  // Track which workspaces have had tasks requested (superset of expanded — includes search-triggered loads)
  const requestedWorkspacesRef = useRef<Set<string>>(new Set());

  // When the user starts searching, eagerly load tasks for all workspaces so
  // the full dataset is searchable (not just previously-expanded workspaces).
  useEffect(() => {
    if (!searchQuery.trim()) {
      return;
    }
    for (const p of workspaces) {
      if (!expanded.has(p.id) && !requestedWorkspacesRef.current.has(p.id)) {
        requestedWorkspacesRef.current.add(p.id);
        loadTasks(p.id);
      }
    }
  }, [searchQuery, workspaces, expanded, loadTasks]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span>Workspaces</span>
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
            onClick={() => setShowCreateForm(!showCreateForm)}
            aria-label="Create workspace"
            title="Create workspace"
          >
            +
          </button>
        </div>
      </div>

      {workspaces.length > 0 && (
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter..."
          aria-label="Filter workspaces and tasks"
          className={styles.searchInput}
          data-testid="sidebar-search"
        />
      )}

      {showCreateForm && (
        <div className={styles.createForm}>
          <input
            type="text"
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateWorkspace()}
            placeholder="Workspace name..."
            autoFocus
            disabled={workspaceCreating}
            className={styles.createInput}
          />
          <button
            onClick={handleCreateWorkspace}
            className={styles.createButton}
            disabled={workspaceCreating}
          >
            {workspaceCreating
              ? <Spinner size="sm" label="Creating workspace" />
              : "OK"}
          </button>
        </div>
      )}
      {workspaceCreating && (
        <div className={styles.creatingHint}>
          <Spinner size="sm" label="Creating workspace" />
          Creating workspace…
        </div>
      )}

      {workspaces.length === 0 && !showCreateForm && (
        <div className={styles.emptyCta}>
          <button
            className={styles.ctaButton}
            onClick={() => setShowCreateForm(true)}
          >
            Create Workspace
          </button>
          <div className={styles.ctaDescription}>
            Organize your work into workspaces
          </div>
        </div>
      )}

      {workspaces.map((workspace) => {
        // Skip workspaces that don't match the search filter
        if (visibleWorkspaceIds && !visibleWorkspaceIds.has(workspace.id)) {
          return null;
        }

        const isSearching = directMatchTaskIds !== null;
        const isExpanded = expanded.has(workspace.id) || isSearching;
        const allWorkspaceTasks = tasks.filter((t) => t.workspaceId === workspace.id);
        // When a workspace matches directly, show all its tasks; otherwise filter to matching tasks only
        const workspaceMatchedDirectly = matchedWorkspaceIds?.has(workspace.id) ?? false;
        const activeMatchIds = isSearching && !workspaceMatchedDirectly
          ? (groupByStatus ? directMatchTaskIds : treeMatchTaskIds)
          : null;
        const workspaceTasks = activeMatchIds
          ? allWorkspaceTasks.filter((t) => activeMatchIds.has(t.id))
          : allWorkspaceTasks;
        const isSelected = selectedWorkspaceId === workspace.id;
        const tree = isExpanded && !groupByStatus ? buildTaskTree(workspaceTasks) : [];

        return (
          <div key={workspace.id}>
            <div
              onClick={() => {
                if (isSelected) {
                  // Already viewing this workspace — toggle expand/collapse
                  toggleExpand(workspace.id);
                } else {
                  // Navigate to workspace — ensure expanded
                  if (!isExpanded) {
                    toggleExpand(workspace.id);
                  }
                  navigate(workspaceUrl(workspace.id));
                }
              }}
              className={`${styles.workspaceRow} ${isSelected ? styles.selected : ""}`}
            >
              <span className={`${styles.expandArrow} ${isExpanded ? styles.expanded : ""}`}>
                {"\u25B8"}
              </span>
              <span className={styles.workspaceName} title={workspace.name}>{workspace.name}</span>
              <span className={styles.taskCount}>
                {allWorkspaceTasks.length > 0 && `${allWorkspaceTasks.filter((t) => t.status === "complete").length}/${allWorkspaceTasks.length}`}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(newTaskUrl(workspace.id));
                }}
                title="New task"
                className={styles.newTaskButton}
              >
                +
              </button>
            </div>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  style={{ overflow: "hidden" }}
                >
                  {groupByStatus ? (
                    groupTasksByStatus(workspaceTasks, taskStatusById).map(group => (
                      <StatusGroupAccordion
                        key={group.status}
                        group={group}
                        isExpanded={isGroupExpanded(workspace.id, group.status)}
                        onToggle={() => toggleStatusGroup(workspace.id, group.status)}
                        selectedTaskId={selectedTaskId}
                        navigate={navigate}
                        titleHighlights={titleHighlights}
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
                        workspaceId={workspace.id}
                        taskStatusById={taskStatusById}
                        titleHighlights={titleHighlights}
                      />
                    ))
                  )}

                  {workspaceTasks.length === 0 && (
                    <div className={styles.emptyTaskCta}>
                      <button
                        className={styles.createTaskLink}
                        onClick={() => navigate(newTaskUrl(workspace.id))}
                      >
                        + Create Task
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
