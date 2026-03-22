import { useEffect, useRef, useState, type JSX } from "react";
import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { DagView } from "../components/dag/DagView.js";
import { WorkspaceBoard } from "../components/workspace/WorkspaceBoard.js";
import { Breadcrumbs, ConfirmDialog } from "../components/display/index.js";
import type { BreadcrumbSegment } from "../utils/breadcrumbs.js";
import { HOME_URL, newTaskUrl, useAppNavigate } from "../utils/navigation.js";
import {
  EditableTextField,
  EditableTextArea,
  EditableSelect,
  EditableCheckbox,
  EnvironmentSelect,
} from "../components/editable/index.js";
import Markdown from "react-markdown";
import { formatCost } from "../utils/format.js";
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

type WorkspaceTab = "tasks" | "board" | "graph";

/** Workspace overview page with inline editing, progress bar, and DAG/task views. */
export function WorkspacePage(): JSX.Element {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useAppNavigate();
  const {
    tasks, environments, workspaces, personas, sessions, archiveWorkspace, updateWorkspace,
    usageCache, loadUsage,
  } = useGrackle();

  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("tasks");
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [metaCollapsed, setMetaCollapsed] = useState(false);
  const previousWorkspaceIdRef = useRef<string | undefined>(undefined);

  const workspace = workspaces.find((p) => p.id === workspaceId);
  const breadcrumbs: BreadcrumbSegment[] = [{ label: "Home", url: HOME_URL }, { label: workspace?.name ?? "Workspace", url: undefined }];

  // Reset edit state when workspaceId changes
  useEffect(() => {
    const previousWorkspaceId = previousWorkspaceIdRef.current;
    previousWorkspaceIdRef.current = workspaceId;
    if (previousWorkspaceId === undefined || previousWorkspaceId === workspaceId) {
      return;
    }
    if (activeFieldId !== null) {
      setActiveFieldId(null);
    }
  }, [workspaceId, activeFieldId]);

  // Load usage stats for the workspace.
  // Re-fetch when sessions change (e.g. usage event updates a session's costUsd).
  const totalSessionCost = sessions.reduce((s, sess) => s + (sess.costUsd ?? 0), 0);
  useEffect(() => {
    if (workspaceId) {
      loadUsage("workspace", workspaceId);
    }
  }, [workspaceId, loadUsage, totalSessionCost]);
  const wsUsage = workspaceId ? usageCache[`workspace:${workspaceId}`] : undefined;

  const workspaceTasks = tasks.filter((t) => t.workspaceId === workspaceId);
  const done = workspaceTasks.filter((t) => t.status === "complete").length;
  const total = workspaceTasks.length;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className={styles.panelContainer}>
      <Breadcrumbs segments={breadcrumbs} />

      {/* Workspace header */}
      <div className={styles.workspaceHeader}>
        <span className={styles.workspaceName} data-testid="workspace-name">
          <EditableTextField
            value={workspace?.name || ""}
            onSave={(v) => { if (workspace) { updateWorkspace(workspace.id, { name: v }); } }}
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
            ariaLabel="Workspace name"
            renderDisplay={(v) => v || workspaceId || undefined}
            data-testid="edit-name"
          />
        </span>
        <button
          className={styles.archiveButton}
          onClick={() => setShowArchiveConfirm(true)}
          title="Archive workspace"
          data-testid="archive-workspace-button"
        >
          Archive
        </button>
      </div>

      {/* Collapsible metadata toggle */}
      <button
        className={styles.metaToggle}
        onClick={() => setMetaCollapsed(!metaCollapsed)}
        aria-expanded={!metaCollapsed}
        aria-controls="workspace-meta-panel"
        data-testid="meta-toggle"
      >
        <span className={`${styles.metaToggleArrow} ${!metaCollapsed ? styles.metaToggleArrowOpen : ""}`}>&#x25B6;</span>
        Details
      </button>

      {/* Workspace metadata (collapsible) */}
      {!metaCollapsed && (
        <div className={styles.workspaceMeta} data-testid="workspace-meta" id="workspace-meta-panel">
          {/* Description */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Description</span>
            <div className={styles.metaValue}>
              <EditableTextArea
                value={workspace?.description || ""}
                onSave={(v) => { if (workspace) { updateWorkspace(workspace.id, { description: v }); } }}
                fieldId="description"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                renderDisplay={(v) => v ? (
                  <span className={styles.overviewMarkdown}>
                    <Markdown remarkPlugins={[remarkGfm]}>{v}</Markdown>
                  </span>
                ) : undefined}
                placeholder="No description"
                ariaLabel="Workspace description"
                data-testid="edit-description"
              />
            </div>
          </div>

          {/* Repo URL */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Repository</span>
            <div className={styles.metaValue}>
              <EditableTextField
                value={workspace?.repoUrl || ""}
                onSave={(v) => { if (workspace) { updateWorkspace(workspace.id, { repoUrl: v }); } }}
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
                ariaLabel="Workspace repository URL"
                data-testid="edit-repo"
              />
            </div>
          </div>

          {/* Default Environment */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Environment</span>
            <div className={styles.metaValue}>
              <EnvironmentSelect
                value={workspace?.environmentId || ""}
                onSave={(v) => { if (workspace && v) { updateWorkspace(workspace.id, { environmentId: v }); } }}
                environments={environments}
                fieldId="environmentId"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder="Select environment"
                ariaLabel="Workspace environment"
                data-testid="edit-env"
              />
            </div>
          </div>

          {/* Default Persona */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Persona</span>
            <div className={styles.metaValue}>
              <EditableSelect
                value={workspace?.defaultPersonaId || ""}
                onSave={(v) => { if (workspace) { updateWorkspace(workspace.id, { defaultPersonaId: v }); } }}
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
                placeholder={workspace?.defaultPersonaId || "(Inherit)"}
                ariaLabel="Workspace default persona"
                data-testid="edit-persona"
              />
            </div>
          </div>

          {/* Worktree Isolation */}
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Worktrees</span>
            <div className={styles.metaValue}>
              <EditableCheckbox
                checked={workspace?.useWorktrees ?? true}
                onChange={(checked) => {
                  if (workspace) {
                    updateWorkspace(workspace.id, { useWorktrees: checked });
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
                value={workspace?.worktreeBasePath || ""}
                onSave={(v) => { if (workspace) { updateWorkspace(workspace.id, { worktreeBasePath: v }); } }}
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
          {workspace && (
            <div className={styles.metaTimestamps}>
              <span className={styles.metaTimestamp}>
                Created {relativeTime(workspace.createdAt)}
              </span>
              {workspace.updatedAt && workspace.updatedAt !== workspace.createdAt && (
                <span className={styles.metaTimestamp}>
                  &middot; Updated {relativeTime(workspace.updatedAt)}
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

      {/* Usage summary */}
      {wsUsage && wsUsage.costUsd > 0 && (
        <div className={styles.progressBarContainer}>
          <span className={styles.progressLabel}>
            Usage: {formatCost(wsUsage.costUsd)} ({wsUsage.sessionCount} session{wsUsage.sessionCount !== 1 ? "s" : ""})
          </span>
        </div>
      )}

      {/* Tabs: Graph / Board / Tasks */}
      <div className={styles.tabBar} role="tablist" aria-label="Workspace view">
        <button
          role="tab"
          aria-selected={workspaceTab === "graph"}
          className={`${styles.tab} ${workspaceTab === "graph" ? styles.active : ""}`}
          onClick={() => setWorkspaceTab("graph")}
        >
          Graph
        </button>
        <button
          role="tab"
          aria-selected={workspaceTab === "board"}
          className={`${styles.tab} ${workspaceTab === "board" ? styles.active : ""}`}
          onClick={() => setWorkspaceTab("board")}
          data-testid="board-tab"
        >
          Board
        </button>
        <button
          role="tab"
          aria-selected={workspaceTab === "tasks"}
          className={`${styles.tab} ${workspaceTab === "tasks" ? styles.active : ""}`}
          onClick={() => setWorkspaceTab("tasks")}
        >
          Tasks
        </button>
      </div>
      {workspaceTab === "tasks" && total > 0 && (
        <div className={styles.workspaceSummary}>
          <span className={styles.workspaceSummaryTitle}>
            {`${done}/${total} tasks complete`}
          </span>
          <span className={styles.workspaceSummarySubtitle}>Select a task or click + to create one</span>
        </div>
      )}
      {workspaceTab === "tasks" && total === 0 && (
        <div className={styles.emptyCta}>
          <button
            className={styles.ctaButton}
            onClick={() => navigate(newTaskUrl(workspaceId!))}
          >
            Create Task
          </button>
          <div className={styles.ctaDescription}>
            Break your work into tasks and let agents tackle them
          </div>
        </div>
      )}
      {workspaceTab === "board" && (
        <WorkspaceBoard workspaceId={workspaceId!} />
      )}
      {workspaceTab === "graph" && (
        <DagView workspaceId={workspaceId!} />
      )}

      {/* Archive confirmation dialog */}
      <ConfirmDialog
        isOpen={showArchiveConfirm}
        title="Archive Workspace?"
        description="This will hide the workspace from the sidebar. Tasks will not be deleted."
        confirmLabel="Archive"
        onConfirm={() => {
          if (workspace) {
            archiveWorkspace(workspace.id);
            navigate("/", { replace: true });
          }
          setShowArchiveConfirm(false);
        }}
        onCancel={() => setShowArchiveConfirm(false)}
      />
    </div>
  );
}
