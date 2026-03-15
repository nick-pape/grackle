import { useEffect, useRef, useState, type JSX } from "react";
import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { DagView } from "../components/dag/DagView.js";
import { Breadcrumbs, ConfirmDialog } from "../components/display/index.js";
import { buildProjectBreadcrumbs } from "../utils/breadcrumbs.js";
import { newTaskUrl, useAppNavigate } from "../utils/navigation.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "../components/panels/SessionPanel.module.scss";

/** Derives a color class for an environment status string. */
function envStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "ready" || s === "running" || s === "available" || s === "connected") return styles.envDotGreen;
  if (s === "provisioning" || s === "starting" || s === "pending" || s === "connecting") return styles.envDotYellow;
  if (s === "error" || s === "failed" || s === "disconnected") return styles.envDotRed;
  return styles.envDotGray;
}

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

type ProjectTab = "tasks" | "graph";
// eslint-disable-next-line @rushstack/no-new-null
type EditingField = "name" | "description" | "repoUrl" | "defaultEnvironmentId" | "worktreeBasePath" | null;

/** Project overview page with inline editing, progress bar, and DAG/task views. */
export function ProjectPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useAppNavigate();
  const {
    tasks, environments, projects, archiveProject, updateProject,
  } = useGrackle();

  const [projectTab, setProjectTab] = useState<ProjectTab>("tasks");
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [editingField, setEditingField] = useState<EditingField>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editError, setEditError] = useState("");
  const [metaCollapsed, setMetaCollapsed] = useState(false);
  const previousProjectIdRef = useRef<string | undefined>(undefined);
  const ignoreInitialBlurFieldRef = useRef<Exclude<EditingField, null> | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);
  const repositoryInputRef = useRef<HTMLInputElement>(null);
  const environmentSelectRef = useRef<HTMLSelectElement>(null);
  const worktreeBasePathInputRef = useRef<HTMLInputElement>(null);

  const breadcrumbs = buildProjectBreadcrumbs(projectId!, projects);

  // Reset edit state when projectId changes
  useEffect(() => {
    const previousProjectId = previousProjectIdRef.current;
    previousProjectIdRef.current = projectId;
    if (previousProjectId === undefined || previousProjectId === projectId) {
      return;
    }
    if (editingField !== null || editDraft !== "") {
      setEditingField(null);
      setEditDraft("");
    }
  }, [projectId, editingField, editDraft]);

  // Auto-focus edit field
  useEffect(() => {
    if (editingField === null) {
      return;
    }
    const focusTarget =
      editingField === "name" ? nameInputRef.current
      : editingField === "description" ? descriptionInputRef.current
      : editingField === "repoUrl" ? repositoryInputRef.current
      : editingField === "worktreeBasePath" ? worktreeBasePathInputRef.current
      : environmentSelectRef.current;
    if (!focusTarget) {
      return;
    }
    const focusTimer = window.setTimeout(() => {
      focusTarget.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [editingField]);

  const project = projects.find((p) => p.id === projectId);
  const projectTasks = tasks.filter((t) => t.projectId === projectId);
  const done = projectTasks.filter((t) => t.status === "complete").length;
  const total = projectTasks.length;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  const MAX_NAME_LENGTH = 100;

  const startEdit = (field: EditingField, currentValue: string): void => {
    ignoreInitialBlurFieldRef.current = field;
    setEditingField(field);
    setEditDraft(currentValue);
    setEditError("");
  };

  const cancelEdit = (): void => {
    ignoreInitialBlurFieldRef.current = null;
    setEditingField(null);
    setEditDraft("");
    setEditError("");
  };

  const validateField = (field: NonNullable<EditingField>, value: string): string => {
    if (field === "name") {
      const trimmed = value.trim();
      if (!trimmed) return "Name is required";
      if (trimmed.length > MAX_NAME_LENGTH) return `Max ${MAX_NAME_LENGTH} characters`;
    }
    if (field === "repoUrl") {
      const trimmed = value.trim();
      if (trimmed && !/^https?:\/\/.+/.test(trimmed)) return "Must be a valid http(s) URL";
    }
    return "";
  };

  const saveEdit = (field: NonNullable<EditingField>): void => {
    if (!project) return;
    const trimmed = editDraft.trim();

    const error = validateField(field, editDraft);
    if (error) {
      setEditError(error);
      return;
    }

    if (field === "name") {
      if (trimmed === project.name) { cancelEdit(); return; }
      updateProject(project.id, { name: trimmed });
    } else if (field === "description") {
      const value = editDraft;
      if (value === project.description) { cancelEdit(); return; }
      updateProject(project.id, { description: value });
    } else if (field === "repoUrl") {
      if (trimmed === project.repoUrl) { cancelEdit(); return; }
      updateProject(project.id, { repoUrl: trimmed });
    } else if (field === "defaultEnvironmentId") {
      if (editDraft === project.defaultEnvironmentId) { cancelEdit(); return; }
      updateProject(project.id, { defaultEnvironmentId: editDraft });
    } else if (field === "worktreeBasePath") {
      if (trimmed === project.worktreeBasePath) { cancelEdit(); return; }
      updateProject(project.id, { worktreeBasePath: trimmed });
    }

    cancelEdit();
  };

  const handleKeyDown = (e: { key: string }, field: NonNullable<EditingField>): void => {
    if (e.key === "Escape") {
      cancelEdit();
    } else if (e.key === "Enter" && field !== "description") {
      saveEdit(field);
    }
  };

  const isDirty = (field: NonNullable<EditingField>): boolean => {
    if (!project) return false;
    if (field === "name") return editDraft.trim() !== project.name;
    if (field === "description") return editDraft !== project.description;
    if (field === "repoUrl") return editDraft.trim() !== project.repoUrl;
    if (field === "defaultEnvironmentId") return editDraft !== project.defaultEnvironmentId;
    if (field === "worktreeBasePath") return editDraft.trim() !== project.worktreeBasePath;
    return false;
  };

  const defaultEnv = environments.find((e) => e.id === project?.defaultEnvironmentId);

  const keyboardHint = editingField === "description"
    ? "Tab to save · Esc to cancel"
    : "Enter to save · Esc to cancel";

  return (
    <div className={styles.panelContainer}>
      <Breadcrumbs segments={breadcrumbs} />

      {/* Project header */}
      <div className={styles.projectHeader}>
        <span className={styles.projectName} data-testid="project-name">
          {editingField === "name" ? (
            <div className={styles.editFieldWrapper}>
              <input
                ref={nameInputRef}
                className={`${styles.editInput} ${editError ? styles.editInputInvalid : ""}`}
                value={editDraft}
                onChange={(e) => { setEditDraft(e.target.value); setEditError(""); }}
                onBlur={(event) => {
                  if (ignoreInitialBlurFieldRef.current === "name") {
                    ignoreInitialBlurFieldRef.current = null;
                    return;
                  }
                  if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.dataset.editAction === "name") {
                    return;
                  }
                  saveEdit("name");
                }}
                onKeyDown={(e) => handleKeyDown(e, "name")}
                maxLength={MAX_NAME_LENGTH}
                aria-label="Project name"
                data-testid="edit-name-input"
              />
              {isDirty("name") && <span className={styles.unsavedDot} title="Unsaved changes" />}
              {editError && <span className={styles.editError} data-testid="edit-error">{editError}</span>}
              <span className={styles.editHint}>{keyboardHint}</span>
            </div>
          ) : (
            <button
              type="button"
              className={styles.metaValueClickable}
              onClick={() => startEdit("name", project?.name || "")}
              title="Click to edit name"
              aria-label={`Edit project name: ${project?.name || projectId}`}
              data-testid="edit-name-button"
            >
              {project?.name || projectId}
              <span className={styles.editButton} aria-hidden="true">
                ✏️
              </span>
            </button>
          )}
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
        <span className={`${styles.metaToggleArrow} ${!metaCollapsed ? styles.metaToggleArrowOpen : ""}`}>▶</span>
        Details
      </button>

      {/* Project metadata (collapsible) */}
      {!metaCollapsed && (
        <div className={styles.projectMeta} data-testid="project-meta" id="project-meta-panel">
          {/* Description */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Description</span>
            <div className={styles.metaValue}>
              {editingField === "description" ? (
                <div className={styles.editFieldWrapper}>
                  <textarea
                    ref={descriptionInputRef}
                    className={styles.editTextarea}
                    value={editDraft}
                    onChange={(e) => { setEditDraft(e.target.value); setEditError(""); }}
                    onBlur={(event) => {
                      if (ignoreInitialBlurFieldRef.current === "description") {
                        ignoreInitialBlurFieldRef.current = null;
                        return;
                      }
                      if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.dataset.editAction === "description") {
                        return;
                      }
                      saveEdit("description");
                    }}
                    onKeyDown={(e) => handleKeyDown(e, "description")}
                    title="Project description"
                    aria-label="Project description"
                    data-testid="edit-description-input"
                  />
                  {isDirty("description") && <span className={styles.unsavedDot} title="Unsaved changes" />}
                  <span className={styles.editHint}>{keyboardHint}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.metaValueClickable}
                  onClick={() => startEdit("description", project?.description || "")}
                  title="Click to edit description"
                  aria-label="Edit project description"
                  data-testid="edit-description-button"
                >
                  {project?.description ? (
                    <span className={styles.overviewMarkdown}>
                      <Markdown remarkPlugins={[remarkGfm]}>{project.description}</Markdown>
                    </span>
                  ) : (
                    <span className={styles.metaPlaceholder}>No description</span>
                  )}
                  <span className={styles.editButton} aria-hidden="true">
                    ✏️
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Repo URL */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Repository</span>
            <div className={styles.metaValue}>
              {editingField === "repoUrl" ? (
                <div className={styles.editFieldWrapper}>
                  <input
                    ref={repositoryInputRef}
                    className={`${styles.editInput} ${editError ? styles.editInputInvalid : ""}`}
                    value={editDraft}
                    onChange={(e) => { setEditDraft(e.target.value); setEditError(""); }}
                    onBlur={(event) => {
                      if (ignoreInitialBlurFieldRef.current === "repoUrl") {
                        ignoreInitialBlurFieldRef.current = null;
                        return;
                      }
                      if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.dataset.editAction === "repoUrl") {
                        return;
                      }
                      saveEdit("repoUrl");
                    }}
                    onKeyDown={(e) => handleKeyDown(e, "repoUrl")}
                    placeholder="https://github.com/..."
                    aria-label="Project repository URL"
                    data-testid="edit-repo-input"
                  />
                  {isDirty("repoUrl") && <span className={styles.unsavedDot} title="Unsaved changes" />}
                  {editError && <span className={styles.editError} data-testid="edit-error">{editError}</span>}
                  <span className={styles.editHint}>{keyboardHint}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.metaValueClickable}
                  onClick={(e) => { e.preventDefault(); startEdit("repoUrl", project?.repoUrl || ""); }}
                  title="Click to edit repository URL"
                  aria-label="Edit project repository URL"
                  data-testid="edit-repo-button"
                >
                  {project?.repoUrl && /^https?:\/\//i.test(project.repoUrl) ? (
                    <a
                      className={styles.repoLink}
                      href={project.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {project.repoUrl}
                    </a>
                  ) : project?.repoUrl ? (
                    <span>{project.repoUrl}</span>
                  ) : (
                    <span className={styles.metaPlaceholder}>No repository</span>
                  )}
                  <span className={styles.editButton} aria-hidden="true">
                    ✏️
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Default Environment */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Environment</span>
            <div className={styles.metaValue}>
              {editingField === "defaultEnvironmentId" ? (
                <select
                  ref={environmentSelectRef}
                  className={styles.editSelect}
                  value={editDraft}
                  onChange={(e) => {
                    ignoreInitialBlurFieldRef.current = null;
                    setEditDraft(e.target.value);
                    const val = e.target.value;
                    if (project && val !== project.defaultEnvironmentId) {
                      updateProject(project.id, { defaultEnvironmentId: val });
                    }
                    cancelEdit();
                  }}
                  onBlur={(event) => {
                    if (ignoreInitialBlurFieldRef.current === "defaultEnvironmentId") {
                      ignoreInitialBlurFieldRef.current = null;
                      return;
                    }
                    if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.dataset.editAction === "defaultEnvironmentId") {
                      return;
                    }
                    cancelEdit();
                  }}
                  title="Default environment"
                  aria-label="Project default environment"
                  data-testid="edit-env-select"
                >
                  <option value="">None</option>
                  {environments.map((env) => (
                    <option key={env.id} value={env.id}>{env.displayName}</option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  className={styles.metaValueClickable}
                  onClick={() => startEdit("defaultEnvironmentId", project?.defaultEnvironmentId || "")}
                  title="Click to change default environment"
                  aria-label="Edit project default environment"
                  data-testid="edit-env-button"
                >
                  {defaultEnv ? (
                    <span className={styles.envRow}>
                      <span className={`${styles.envDot} ${envStatusClass(defaultEnv.status)}`} />
                      {defaultEnv.displayName}
                    </span>
                  ) : (
                    <span className={styles.metaPlaceholder}>
                      {project?.defaultEnvironmentId || "No default environment"}
                    </span>
                  )}
                  <span className={styles.editButton} aria-hidden="true">
                    ✏️
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Worktree Base Path */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Worktree Base</span>
            <div className={styles.metaValue}>
              {editingField === "worktreeBasePath" ? (
                <div className={styles.editFieldWrapper}>
                  <input
                    ref={worktreeBasePathInputRef}
                    className={`${styles.editInput} ${editError ? styles.editInputInvalid : ""}`}
                    value={editDraft}
                    onChange={(e) => { setEditDraft(e.target.value); setEditError(""); }}
                    onBlur={(event) => {
                      if (ignoreInitialBlurFieldRef.current === "worktreeBasePath") {
                        ignoreInitialBlurFieldRef.current = null;
                        return;
                      }
                      if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.dataset.editAction === "worktreeBasePath") {
                        return;
                      }
                      saveEdit("worktreeBasePath");
                    }}
                    onKeyDown={(e) => handleKeyDown(e, "worktreeBasePath")}
                    placeholder="/workspaces/my-repo"
                    aria-label="Worktree base path"
                    data-testid="edit-worktree-base-path-input"
                  />
                  {isDirty("worktreeBasePath") && <span className={styles.unsavedDot} title="Unsaved changes" />}
                  {editError && <span className={styles.editError} data-testid="edit-error">{editError}</span>}
                  <span className={styles.editHint}>{keyboardHint}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.metaValueClickable}
                  onClick={() => startEdit("worktreeBasePath", project?.worktreeBasePath || "")}
                  title="Click to edit worktree base path"
                  aria-label="Edit worktree base path"
                  data-testid="edit-worktree-base-path-button"
                >
                  {project?.worktreeBasePath ? (
                    <span>{project.worktreeBasePath}</span>
                  ) : (
                    <span className={styles.metaPlaceholder}>Default (server default)</span>
                  )}
                  <span className={styles.editButton} aria-hidden="true">
                    ✏️
                  </span>
                </button>
              )}
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
                  · Updated {relativeTime(project.updatedAt)}
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

      {/* Tabs: Graph / Tasks */}
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
