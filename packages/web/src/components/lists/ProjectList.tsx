import { useEffect, useState, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import type { ViewMode } from "../../App.js";
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
};

/** Sidebar project tree with expandable task lists. */
export function ProjectList({ viewMode, setViewMode }: Props): JSX.Element {
  const { projects, tasks, loadTasks, createProject } = useGrackle();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const selectedProjectId = viewMode.kind === "project" ? viewMode.projectId : null;
  const selectedTaskId = viewMode.kind === "task" ? viewMode.taskId : null;

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
                  {projectTasks.map((task, index) => {
                    const statusStyle = TASK_STATUS_STYLES[task.status] || TASK_STATUS_STYLES.pending;
                    const isTaskSelected = selectedTaskId === task.id;

                    return (
                      <motion.div
                        key={task.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.03, duration: 0.2 }}
                        onClick={() => setViewMode({ kind: "task", taskId: task.id })}
                        className={`${styles.taskRow} ${isTaskSelected ? styles.selected : ""}`}
                      >
                        <span className={styles.taskStatusIcon} style={{ color: statusStyle.color }}>
                          {statusStyle.icon}
                        </span>
                        <span className={styles.taskTitle}>
                          {task.title}
                        </span>
                        {task.dependsOn.length > 0 && (
                          <span className={styles.dependencyBadge} title={`Depends on: ${task.dependsOn.join(", ")}`}>
                            dep
                          </span>
                        )}
                      </motion.div>
                    );
                  })}

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
