import { useEffect, useState, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import type { ViewMode } from "../../App.js";
import type { TaskData } from "../../hooks/useGrackleSocket.js";
import { AnimatePresence, motion } from "motion/react";
import styles from "./ProjectList.module.scss";

/** Props for the ProjectList component. */
interface Props {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

/** Task status visual indicators using CSS custom property colors. */
const TASK_STATUS_STYLES: Record<string, { color: string; icon: string }> = {
  pending: { color: "var(--text-tertiary)", icon: "\u25CB" },
  assigned: { color: "var(--accent-blue)", icon: "\u25CE" },
  in_progress: { color: "var(--accent-green)", icon: "\u25CF" },
  review: { color: "var(--accent-yellow)", icon: "\u25C9" },
  done: { color: "var(--accent-green)", icon: "\u2713" },
  failed: { color: "var(--accent-red)", icon: "\u2717" },
  waiting: { color: "var(--accent-purple, #a78bfa)", icon: "\u29D6" },
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
  setViewMode: (mode: ViewMode) => void;
}

/** Renders a single task tree node with optional children. */
function TaskTreeNode({
  node,
  depth,
  expandedTasks,
  toggleTask,
  selectedTaskId,
  setViewMode,
}: TaskTreeNodeProps): JSX.Element {
  const statusStyle = TASK_STATUS_STYLES[node.status] || TASK_STATUS_STYLES.pending;
  const isExpanded = expandedTasks.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedTaskId === node.id;
  const indent = TASK_BASE_INDENT_PX + depth * TASK_DEPTH_INDENT_PX;

  return (
    <>
      <div
        onClick={() => setViewMode({ kind: "task", taskId: node.id })}
        className={`${styles.taskRow} ${isSelected ? styles.selected : ""}`}
        style={{ paddingLeft: indent }}
      >
        {hasChildren && (
          <span
            className={`${styles.expandArrow} ${isExpanded ? styles.expanded : ""}`}
            onClick={(e) => { e.stopPropagation(); toggleTask(node.id); }}
          >
            {"\u25B8"}
          </span>
        )}
        {!hasChildren && <span className={styles.leafSpacer} />}
        <span className={styles.taskStatusIcon} style={{ color: statusStyle.color }}>
          {statusStyle.icon}
        </span>
        <span className={styles.taskTitle}>{node.title}</span>
        {hasChildren && (
          <span className={styles.childCountBadge}>
            {node.children.filter(c => c.status === "done").length}/{node.children.length}
          </span>
        )}
        {node.dependsOn.length > 0 && (
          <span className={styles.dependencyBadge} title={`Depends on: ${node.dependsOn.join(", ")}`}>
            dep
          </span>
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
                setViewMode={setViewMode}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Sidebar project tree with expandable task lists and hierarchical task rendering. */
export function ProjectList({ viewMode, setViewMode }: Props): JSX.Element {
  const { projects, tasks, loadTasks, createProject } = useGrackle();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const selectedProjectId = viewMode.kind === "project" ? viewMode.projectId : undefined;
  const selectedTaskId = viewMode.kind === "task" ? viewMode.taskId : undefined;

  const toggleExpand = (projectId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
        loadTasks(projectId);
      }
      return next;
    });
  };

  const toggleTask = (taskId: string): void => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  // Auto-expand parent tasks that have children
  useEffect(() => {
    const parentIds = new Set(
      tasks.filter(t => t.parentTaskId).map(t => t.parentTaskId),
    );
    if (parentIds.size > 0) {
      setExpandedTasks((prev) => {
        const next = new Set(prev);
        for (const pid of parentIds) {
          next.add(pid);
        }
        return next;
      });
    }
  }, [tasks]);

  // Auto-expand a project when selected
  useEffect(() => {
    if (selectedProjectId && !expanded.has(selectedProjectId)) {
      setExpanded((prev) => new Set(prev).add(selectedProjectId));
      loadTasks(selectedProjectId);
    }
  }, [selectedProjectId, expanded, loadTasks]);

  const handleCreateProject = (): void => {
    if (!newProjectName.trim()) {
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
            className={styles.createInput}
          />
          <button onClick={handleCreateProject} className={styles.createButton}>
            OK
          </button>
        </div>
      )}

      {projects.length === 0 && !showCreateForm && (
        <div className={styles.emptyState}>
          No projects. Click + to create one.
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
                toggleExpand(project.id);
                setViewMode({ kind: "project", projectId: project.id });
              }}
              className={`${styles.projectRow} ${isSelected ? styles.selected : ""}`}
            >
              <span className={`${styles.expandArrow} ${isExpanded ? styles.expanded : ""}`}>
                {"\u25B8"}
              </span>
              <span className={styles.projectName}>{project.name}</span>
              <span className={styles.taskCount}>
                {projectTasks.length > 0 && `${projectTasks.filter((t) => t.status === "done").length}/${projectTasks.length}`}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewMode({ kind: "new_task", projectId: project.id });
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
                      setViewMode={setViewMode}
                    />
                  ))}

                  {projectTasks.length === 0 && (
                    <div className={styles.emptyTasks}>
                      No tasks yet
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
