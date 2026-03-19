import { useEffect, useRef, useState, type JSX } from "react";
import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { DagView } from "../components/dag/DagView.js";
import { ProjectBoard } from "../components/project/ProjectBoard.js";
import { Breadcrumbs, ConfirmDialog } from "../components/display/index.js";
import { buildProjectBreadcrumbs } from "../utils/breadcrumbs.js";
import { newTaskUrl, useAppNavigate } from "../utils/navigation.js";
import {
  EditableTextField,
  EditableTextArea,
  EditableSelect,
  EditableCheckbox,
  EnvironmentSelect,
} from "../components/editable/index.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "../components/panels/SessionPanel.module.scss";



/** Converts an ISO timestamp into a human-friendly relative time string. */
function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const MAX_NAME_LENGTH: number = 100;

type ProjectTab = "tasks" | "board" | "graph";

/** Project overview page with inline editing, progress bar, and DAG/task views. */
export function ProjectPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useAppNavigate();
  const {
    tasks, environments, projects, personas, archiveProject, updateProject,
  } = useGrackle();

  const [projectTab, setProjectTab] = useState<ProjectTab>("tasks");
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [metaCollapsed, setMetaCollapsed] = useState(false);
  const previousProjectIdRef = useRef<string | undefined>(undefined);

  const breadcrumbs = buildProjectBreadcrumbs(projectId!, projects);

  // Reset edit state when projectId changes
  useEffect(() => {
    const previousProjectId = previousProjectIdRef.current;
    previousProjectIdRef.current = projectId;
    if (previousProjectId === undefined || previousProjectId === projectId) {
      return;
    }
    if (activeFieldId !== null) {
      setActiveFieldId(null);
    }
  }, [projectId, activeFieldId]);

  const project = projects.find((p) => p.id === projectId);
  const projectTasks = tasks.filter((t) => t.projectId === projectId);
  const done = projectTasks.filter((t) => t.status === "complete").length;
  const total = projectTasks.length;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className={styles.panelContainer}>
      <Breadcrumbs segments={breadcrumbs} />

      {/* Project header */}
      <div className={styles.projectHeader}>
        <span className={styles.projectName} data-testid="project-name">
          <EditableTextField
            value={project?.name || ""}
            onSave={(v) => { if (project) { updateProject(project.id, { name: v }); } }}
            validate={(v) => {
              const trimmed = v.trim();
              if (!trimmed) return "Name is required";
              if (trimmed.length > MAX_NAME_LENGTH) return `Max ${MAX_NAME_LENGTH} characters`;
              return undefined;
            }}
            maxLength={MAX_NAME_LENGTH}
            fieldId="name"
            activeFieldId={activeFieldId}
            onActivate={setActiveFieldId}
            ariaLabel="Project name"
            renderDisplay={(v) => v || projectId || undefined}
            data-testid="edit-name"
          />
        </span>
        <button
          className={styles.archiveButton}
          onClick={() => setShowArchiveConfirm(true)}
          title="Archive project"
          data-testid="archive-project-button"
        >
          Archive
        </button>
      </div>

      {/* Collapsible metadata toggle */}
      <button
        className={styles.metaToggle}
        onClick={() => setMetaCollapsed(!metaCollapsed)}
        aria-expanded={!metaCollapsed}
        aria-controls="project-meta-panel"
        data-testid="meta-toggle"
      >
        <span className={`${styles.metaToggleArrow} ${!metaCollapsed ? styles.metaToggleArrowOpen : ""}`}>&#x25B6;</span>
        Details
      </button>

      {/* Project metadata (collapsible) */}
      {!metaCollapsed && (
        <div className={styles.projectMeta} data-testid="project-meta" id="project-meta-panel">
          {/* Description */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Description</span>
            <div className={styles.metaValue}>
              <EditableTextArea
                value={project?.description || ""}
                onSave={(v) => { if (project) { updateProject(project.id, { description: v }); } }}
                fieldId="description"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                renderDisplay={(v) => v ? (
                  <span className={styles.overviewMarkdown}>
                    <Markdown remarkPlugins={[remarkGfm]}>{v}</Markdown>
                  </span>
                ) : undefined}
                placeholder="No description"
                ariaLabel="Project description"
                data-testid="edit-description"
              />
            </div>
          </div>

          {/* Repo URL */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Repository</span>
            <div className={styles.metaValue}>
              <EditableTextField
                value={project?.repoUrl || ""}
                onSave={(v) => { if (project) { updateProject(project.id, { repoUrl: v }); } }}
                validate={(v) => {
                  const trimmed = v.trim();
                  if (trimmed && !/^https?:\/\/.+/.test(trimmed)) return "Must be a valid http(s) URL";
                  return undefined;
                }}
                fieldId="repoUrl"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                renderDisplay={(v) => {
                  if (v && /^https?:\/\//i.test(v)) {
                    return (
                      <a
                        className={styles.repoLink}
                        href={v}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {v}
                      </a>
                    );
                  }
                  return v ? <span>{v}</span> : undefined;
                }}
                placeholder="No repository"
                ariaLabel="Project repository URL"
                data-testid="edit-repo"
              />
            </div>
          </div>

          {/* Default Environment */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Environment</span>
            <div className={styles.metaValue}>
              <EnvironmentSelect
                value={project?.defaultEnvironmentId || ""}
                onSave={(v) => { if (project) { updateProject(project.id, { defaultEnvironmentId: v }); } }}
                environments={environments}
                allowNone
                fieldId="defaultEnvironmentId"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder={project?.defaultEnvironmentId || "No default environment"}
                ariaLabel="Project default environment"
                data-testid="edit-env"
              />
            </div>
          </div>

          {/* Default Persona */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Persona</span>
            <div className={styles.metaValue}>
              <EditableSelect
                value={project?.defaultPersonaId || ""}
                onSave={(v) => { if (project) { updateProject(project.id, { defaultPersonaId: v }); } }}
                options={[
                  { value: "", label: "(Inherit)" },
                  ...personas.map((p) => ({ value: p.id, label: p.name })),
                ]}
                fieldId="defaultPersonaId"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                renderDisplay={(v) => {
                  const persona = personas.find((p) => p.id === v);
                  if (persona) return <span>{persona.name}</span>;
                  return undefined;
                }}
                placeholder={project?.defaultPersonaId || "(Inherit)"}
                ariaLabel="Project default persona"
                data-testid="edit-persona"
              />
            </div>
          </div>

          {/* Worktree Isolation */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Worktrees</span>
            <div className={styles.metaValue}>
              <EditableCheckbox
                checked={project?.useWorktrees ?? true}
                onChange={(checked) => {
                  if (project) {
                    updateProject(project.id, { useWorktrees: checked });
                  }
                }}
                label="Enable worktree isolation"
                data-testid="worktree-toggle"
              />
            </div>
          </div>

          {/* Working Directory */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Working Dir</span>
            <div className={styles.metaValue}>
              <EditableTextField
                value={project?.worktreeBasePath || ""}
                onSave={(v) => { if (project) { updateProject(project.id, { worktreeBasePath: v }); } }}
                fieldId="worktreeBasePath"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder="Default (server default)"
                ariaLabel="Working directory"
                data-testid="edit-worktree-base-path"
              />
            </div>
          </div>

          {/* Timestamps */}
          {project && (
            <div className={styles.metaTimestamps}>
              <span className={styles.metaTimestamp}>
                Created {relativeTime(project.createdAt)}
              </span>
              {project.updatedAt && project.updatedAt !== project.createdAt && (
                <span className={styles.metaTimestamp}>
                  &middot; Updated {relativeTime(project.updatedAt)}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Task progress bar */}
      {total > 0 && (
        <div className={styles.progressBarContainer} data-testid="progress-bar">
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
          </div>
          <span className={styles.progressLabel}>{done}/{total}</span>
        </div>
      )}

      {/* Tabs: Graph / Board / Tasks */}
      <div className={styles.tabBar} role="tablist" aria-label="Project view">
        <button
          role="tab"
          aria-selected={projectTab === "graph"}
          className={`${styles.tab} ${projectTab === "graph" ? styles.active : ""}`}
          onClick={() => setProjectTab("graph")}
        >
          Graph
        </button>
        <button
          role="tab"
          aria-selected={projectTab === "board"}
          className={`${styles.tab} ${projectTab === "board" ? styles.active : ""}`}
          onClick={() => setProjectTab("board")}
          data-testid="board-tab"
        >
          Board
        </button>
        <button
          role="tab"
          aria-selected={projectTab === "tasks"}
          className={`${styles.tab} ${projectTab === "tasks" ? styles.active : ""}`}
          onClick={() => setProjectTab("tasks")}
        >
          Tasks
        </button>
      </div>
      {projectTab === "tasks" && total > 0 && (
        <div className={styles.projectSummary}>
          <span className={styles.projectSummaryTitle}>
            {`${done}/${total} tasks complete`}
          </span>
          <span className={styles.projectSummarySubtitle}>Select a task or click + to create one</span>
        </div>
      )}
      {projectTab === "tasks" && total === 0 && (
        <div className={styles.emptyCta}>
          <button
            className={styles.ctaButton}
            onClick={() => navigate(newTaskUrl(projectId!))}
          >
            Create Task
          </button>
          <div className={styles.ctaDescription}>
            Break your work into tasks and let agents tackle them
          </div>
        </div>
      )}
      {projectTab === "board" && (
        <ProjectBoard projectId={projectId!} />
      )}
      {projectTab === "graph" && (
        <DagView projectId={projectId!} />
      )}

      {/* Archive confirmation dialog */}
      <ConfirmDialog
        isOpen={showArchiveConfirm}
        title="Archive Project?"
        description="This will hide the project from the sidebar. Tasks will not be deleted."
        confirmLabel="Archive"
        onConfirm={() => {
          if (project) {
            archiveProject(project.id);
            navigate("/", { replace: true });
          }
          setShowArchiveConfirm(false);
        }}
        onCancel={() => setShowArchiveConfirm(false)}
      />
    </div>
  );
}
