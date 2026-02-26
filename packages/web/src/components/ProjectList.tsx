import React, { useEffect, useState, type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import type { ViewMode } from "../App.js";

interface Props {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

const TASK_STATUS_STYLES: Record<string, { color: string; icon: string }> = {
  pending: { color: "#666", icon: "○" },
  assigned: { color: "#70a1ff", icon: "◎" },
  in_progress: { color: "#4ecca3", icon: "●" },
  review: { color: "#f0c040", icon: "◉" },
  done: { color: "#4ecca3", icon: "✓" },
  failed: { color: "#e94560", icon: "✗" },
};

const smallBtnStyle: React.CSSProperties = {
  background: "#4ecca3",
  border: "none",
  color: "#1a1a2e",
  padding: "3px 8px",
  borderRadius: "3px",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: "11px",
  fontWeight: "bold",
};

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
  }, [selectedProjectId]);

  const handleCreateProject = (): void => {
    if (!newProjectName.trim()) return;
    createProject(newProjectName.trim());
    setNewProjectName("");
    setShowCreateForm(false);
  };

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ padding: "4px 12px", fontSize: "11px", color: "#888", textTransform: "uppercase", letterSpacing: "1px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Projects</span>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          style={{
            background: "none",
            border: "1px solid #4ecca3",
            color: "#4ecca3",
            borderRadius: "3px",
            cursor: "pointer",
            fontSize: "12px",
            lineHeight: "1",
            padding: "1px 5px",
            fontFamily: "monospace",
          }}
        >
          +
        </button>
      </div>

      {showCreateForm && (
        <div style={{ padding: "4px 12px", display: "flex", gap: "4px" }}>
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
            placeholder="Project name..."
            autoFocus
            style={{
              flex: 1,
              background: "#0f3460",
              border: "1px solid #333",
              color: "#e0e0e0",
              padding: "3px 6px",
              borderRadius: "3px",
              fontFamily: "monospace",
              fontSize: "11px",
            }}
          />
          <button onClick={handleCreateProject} style={smallBtnStyle}>
            OK
          </button>
        </div>
      )}

      {projects.length === 0 && !showCreateForm && (
        <div style={{ padding: "12px", color: "#666", fontSize: "12px" }}>
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
              style={{
                padding: "6px 12px",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
                background: isSelected ? "#0f3460" : "transparent",
              }}
            >
              <span style={{ color: "#888", fontSize: "10px", width: "12px" }}>
                {isExpanded ? "▾" : "▸"}
              </span>
              <span>{project.name}</span>
              <span style={{ marginLeft: "auto", fontSize: "11px", color: "#666" }}>
                {projectTasks.length > 0 && `${projectTasks.filter((t) => t.status === "done").length}/${projectTasks.length}`}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewMode({ kind: "new_task", projectId: project.id });
                }}
                title="New task"
                style={{
                  background: "none",
                  border: "1px solid #4ecca3",
                  color: "#4ecca3",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "10px",
                  lineHeight: "1",
                  padding: "1px 4px",
                  fontFamily: "monospace",
                }}
              >
                +
              </button>
            </div>

            {isExpanded && projectTasks.map((task) => {
              const statusStyle = TASK_STATUS_STYLES[task.status] || TASK_STATUS_STYLES.pending;
              const isTaskSelected = selectedTaskId === task.id;

              return (
                <div
                  key={task.id}
                  onClick={() => setViewMode({ kind: "task", taskId: task.id })}
                  style={{
                    padding: "3px 12px 3px 34px",
                    fontSize: "12px",
                    cursor: "pointer",
                    background: isTaskSelected ? "#0f3460" : "transparent",
                    color: isTaskSelected ? "#e0e0e0" : "#a0a0a0",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span style={{ color: statusStyle.color, fontSize: "11px" }}>
                    {statusStyle.icon}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {task.title}
                  </span>
                  {task.dependsOn.length > 0 && (
                    <span style={{ fontSize: "9px", color: "#666" }} title={`Depends on: ${task.dependsOn.join(", ")}`}>
                      dep
                    </span>
                  )}
                </div>
              );
            })}

            {isExpanded && projectTasks.length === 0 && (
              <div style={{ padding: "3px 12px 3px 34px", fontSize: "11px", color: "#555" }}>
                No tasks yet
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
