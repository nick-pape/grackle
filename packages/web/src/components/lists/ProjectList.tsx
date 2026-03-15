import { useEffect, useMemo, useRef, useState, type JSX } from "react";
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
  pending: { color: "var(--text-tertiary)", icon: "\u25CB" },
  assigned: { color: "var(--accent-blue)", icon: "\u25CE" },
  in_progress: { color: "var(--accent-green)", icon: "\u25CF" },
  review: { color: "var(--accent-yellow)", icon: "\u25C9" },
  done: { color: "var(--accent-green)", icon: "\u2713" },
  failed: { color: "var(--accent-red)", icon: "\u2717" },
  waiting_input: { color: "var(--accent-yellow)", icon: "\u29D6" },
};

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

/** Base left-padding for task rows inside a project. */
const TASK_BASE_INDENT_PX: number = 34;
/** Additional left-padding per depth level. */
const TASK_DEPTH_INDENT_PX: number = 16;


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
  const statusStyle = TASK_STATUS_STYLES[node.status] || TASK_STATUS_STYLES.pending;
  const isBlocked = node.dependsOn.length > 0 &&
    node.dependsOn.some((depId) => taskStatusById.get(depId) !== "done");
  const isExpanded = expandedTasks.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedTaskId === node.id;
  const indent = TASK_BASE_INDENT_PX + depth * TASK_DEPTH_INDENT_PX;

  return (
    <>
      <div
        onClick={() => navigate(taskUrl(node.id))}
        className={`${styles.taskRow} ${isSelected ? styles.selected : ""}`}
        style={{ paddingLeft: indent }}
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
            {node.children.filter(c => c.status === "done").length}/{node.children.length}
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

  // Derive selected state from router
  const taskMatch = useMatch("/tasks/:taskId/*");
  const projectMatch = useMatch("/projects/:projectId");
  const selectedTaskId = taskMatch?.params.taskId;
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
        <button
          className={styles.addButton}
          onClick={() => setShowCreateForm(!showCreateForm)}
          aria-label="Create project"
          title="Create project"
        >
          +
        </button>
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
        const tree = isExpanded ? buildTaskTree(projectTasks) : [];

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
                {projectTasks.length > 0 && `${projectTasks.filter((t) => t.status === "done").length}/${projectTasks.length}`}
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
                  {tree.map(node => (
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
                  ))}

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
