import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import { useMatch } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import type { TaskData } from "../../hooks/useGrackleSocket.js";
import { AnimatePresence, motion } from "motion/react";
import { MAX_TASK_DEPTH } from "@grackle-ai/common";
import { Spinner } from "../display/index.js";
import { taskUrl, projectUrl, newTaskUrl, useAppNavigate } from "../../utils/navigation.js";
import styles from "./ProjectList.module.scss";

/** Task status visual indicators using CSS custom property colors. */
const TASK_STATUS_STYLES: Record<string, { color: string; icon: string }> = {
  not_started: { color: "var(--text-tertiary)", icon: "\u25CB" },
  working: { color: "var(--accent-green)", icon: "\u25CF" },
  paused: { color: "var(--accent-yellow)", icon: "\u25C9" },
  complete: { color: "var(--accent-green)", icon: "\u2713" },
  failed: { color: "var(--accent-red)", icon: "\u2717" },
  blocked: { color: "var(--accent-yellow)", icon: "\u29B8" },
};

/** Base left-padding for task rows inside a project. */
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
// Status grouping
// ---------------------------------------------------------------------------

/** Ordered list of task statuses from most-urgent to least. "blocked" is a virtual status for grouped view. */
const STATUS_GROUP_ORDER: string[] = ["working", "paused", "failed", "not_started", "blocked", "complete"];

/** Human-readable labels for each status group. */
const STATUS_GROUP_LABELS: Record<string, string> = {
  working: "Working",
  paused: "Paused",
  failed: "Failed",
  not_started: "Not Started",
  blocked: "Blocked",
  complete: "Complete",
};

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
    // Tasks with unresolved dependencies go to "blocked" instead of their actual status
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

  // Known statuses in urgency order
  for (const status of STATUS_GROUP_ORDER) {
    seen.add(status);
    const tasks = byStatus.get(status);
    if (tasks && tasks.length > 0) {
      tasks.sort((a, b) => a.sortOrder - b.sortOrder);
      groups.push({
        status,
        label: STATUS_GROUP_LABELS[status] || status,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- status may not be in the map
        style: TASK_STATUS_STYLES[status] || TASK_STATUS_STYLES.not_started,
        tasks,
      });
    }
  }

  // Append any unknown statuses for future-proofing
  for (const [status, tasks] of byStatus) {
    if (!seen.has(status) && tasks.length > 0) {
      tasks.sort((a, b) => a.sortOrder - b.sortOrder);
      groups.push({
        status,
        label: status,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- status may not be in the map
        style: TASK_STATUS_STYLES[status] || TASK_STATUS_STYLES.not_started,
        tasks,
      });
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
}

/** Collapsible accordion for a status group in grouped view. */
function StatusGroupAccordion({
  group,
  isExpanded,
  onToggle,
  selectedTaskId,
  navigate,
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
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- status may not be in the map
              const statusStyle = TASK_STATUS_STYLES[task.status] || TASK_STATUS_STYLES.not_started;
              const isSelected = selectedTaskId === task.id;
              return (
                <div
                  key={task.id}
                  onClick={() => navigate(taskUrl(task.id))}
                  className={`${styles.taskRow} ${isSelected ? styles.selected : ""}`}
                  style={{ paddingLeft: TASK_BASE_INDENT_PX }}
                  data-task-id={task.id}
                >
                  <span className={styles.leafSpacer} />
                  <span className={styles.taskStatusIcon} style={{ color: statusStyle.color }}>
                    {statusStyle.icon}
                  </span>
                  <span className={styles.taskTitle} title={task.title}>{task.title}</span>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
  // Sort children by sortOrder
  for (const node of byId.values()) {
    node.children.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return roots.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Props for the recursive TaskTreeNode component. */
interface TaskTreeNodeProps {
  node: TaskNode;
  depth: number;
  expandedTasks: Set<string>;
  toggleTask: (taskId: string) => void;
  selectedTaskId: string | undefined;
  navigate: ReturnType<typeof useAppNavigate>;
  projectId: string;
  taskStatusById: Map<string, string>;
}

/** Renders a single task tree node with optional children. */
function TaskTreeNode({
  node,
  depth,
  expandedTasks,
  toggleTask,
  selectedTaskId,
  navigate,
  projectId,
  taskStatusById,
}: TaskTreeNodeProps): JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- status may not be in the map
  const statusStyle = TASK_STATUS_STYLES[node.status] || TASK_STATUS_STYLES.not_started;
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
        <span className={styles.taskTitle} title={node.title}>{node.title}</span>
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
              navigate(newTaskUrl(projectId, node.id));
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
                projectId={projectId}
                taskStatusById={taskStatusById}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Sidebar project tree with expandable task lists and hierarchical task rendering. */
export function ProjectList(): JSX.Element {
  const { projects, tasks, loadTasks, createProject, projectCreating } = useGrackle();
  const navigate = useAppNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [manuallyCollapsed, setManuallyCollapsed] = useState<Set<string>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [groupByStatus, setGroupByStatusState] = useState(getGroupByStatus);
  // Track which groups should default to expanded (resets on each toggle-on)
  const [groupExpandDefault, setGroupExpandDefault] = useState(getGroupByStatus);
  // Per-project overrides: "projectId:status" → explicitly collapsed or expanded
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

  /** Toggle a single status group accordion for a specific project. */
  const toggleStatusGroup = (projectId: string, status: string): void => {
    const key = `${projectId}:${status}`;
    setGroupExpandOverrides((prev) => {
      const next = new Map(prev);
      const current = next.has(key) ? next.get(key)! : groupExpandDefault;
      next.set(key, !current);
      return next;
    });
  };

  /** Check if a status group is expanded for a specific project. */
  const isGroupExpanded = (projectId: string, status: string): boolean => {
    const key = `${projectId}:${status}`;
    return groupExpandOverrides.has(key) ? groupExpandOverrides.get(key)! : groupExpandDefault;
  };

  // Derive selected state from router
  const taskMatch = useMatch("/tasks/:taskId/*");
  const projectMatch = useMatch("/projects/:projectId");
  const selectedTaskId = taskMatch?.params.taskId !== "new" ? taskMatch?.params.taskId : undefined;
  const selectedProjectId = projectMatch?.params.projectId;

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

  // Auto-expand a project when selected via programmatic navigation
  useEffect(() => {
    if (selectedProjectId && !expandedRef.current.has(selectedProjectId)) {
      setExpanded((prev) => new Set(prev).add(selectedProjectId));
      loadTasks(selectedProjectId);
    }
  }, [selectedProjectId, loadTasks]);

  const handleCreateProject = (): void => {
    if (!newProjectName.trim() || projectCreating) {
      return;
    }
    createProject(newProjectName.trim());
    setNewProjectName("");
    setShowCreateForm(false);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span>Projects</span>
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
            aria-label="Create project"
            title="Create project"
          >
            +
          </button>
        </div>
      </div>

      {showCreateForm && (
        <div className={styles.createForm}>
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
            placeholder="Project name..."
            autoFocus
            disabled={projectCreating}
            className={styles.createInput}
          />
          <button
            onClick={handleCreateProject}
            className={styles.createButton}
            disabled={projectCreating}
          >
            {projectCreating
              ? <Spinner size="sm" label="Creating project" />
              : "OK"}
          </button>
        </div>
      )}
      {projectCreating && (
        <div className={styles.creatingHint}>
          <Spinner size="sm" label="Creating project" />
          Creating project…
        </div>
      )}

      {projects.length === 0 && !showCreateForm && (
        <div className={styles.emptyCta}>
          <button
            className={styles.ctaButton}
            onClick={() => setShowCreateForm(true)}
          >
            Create Project
          </button>
          <div className={styles.ctaDescription}>
            Organize your work into projects
          </div>
        </div>
      )}

      {projects.map((project) => {
        const isExpanded = expanded.has(project.id);
        const projectTasks = tasks.filter((t) => t.projectId === project.id);
        const isSelected = selectedProjectId === project.id;
        const tree = isExpanded && !groupByStatus ? buildTaskTree(projectTasks) : [];

        return (
          <div key={project.id}>
            <div
              onClick={() => {
                if (isSelected) {
                  // Already viewing this project — toggle expand/collapse
                  toggleExpand(project.id);
                } else {
                  // Navigate to project — ensure expanded
                  if (!isExpanded) {
                    toggleExpand(project.id);
                  }
                  navigate(projectUrl(project.id));
                }
              }}
              className={`${styles.projectRow} ${isSelected ? styles.selected : ""}`}
            >
              <span className={`${styles.expandArrow} ${isExpanded ? styles.expanded : ""}`}>
                {"\u25B8"}
              </span>
              <span className={styles.projectName} title={project.name}>{project.name}</span>
              <span className={styles.taskCount}>
                {projectTasks.length > 0 && `${projectTasks.filter((t) => t.status === "complete").length}/${projectTasks.length}`}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(newTaskUrl(project.id));
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
                    groupTasksByStatus(projectTasks, taskStatusById).map(group => (
                      <StatusGroupAccordion
                        key={group.status}
                        group={group}
                        isExpanded={isGroupExpanded(project.id, group.status)}
                        onToggle={() => toggleStatusGroup(project.id, group.status)}
                        selectedTaskId={selectedTaskId}
                        navigate={navigate}
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
                        projectId={project.id}
                        taskStatusById={taskStatusById}
                      />
                    ))
                  )}

                  {projectTasks.length === 0 && (
                    <div className={styles.emptyTaskCta}>
                      <button
                        className={styles.createTaskLink}
                        onClick={() => navigate(newTaskUrl(project.id))}
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
