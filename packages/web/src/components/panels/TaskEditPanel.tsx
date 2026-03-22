import { useState, useEffect, useRef, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { useToast } from "../../context/ToastContext.js";
import { taskUrl, workspaceUrl, useAppNavigate } from "../../utils/navigation.js";
import styles from "./TaskEditPanel.module.scss";

/** Props for the TaskEditPanel component. */
interface Props {
  mode: "new" | "edit";
  /** Task ID — required in edit mode. */
  taskId?: string;
  /** Workspace ID — required in new mode. */
  workspaceId?: string;
  /** Parent task ID — optional in new mode. */
  parentTaskId?: string;
  /** Environment ID — used for scoped navigation. */
  environmentId?: string;
}

/**
 * Full-panel create/edit form for tasks.
 *
 * - new: blank form; calls createTask on save, then navigates back to
 *        the workspace view.
 * - edit: pre-populated form; calls updateTask on save, then navigates
 *         back to the task overview.
 */
export function TaskEditPanel({ mode, taskId, workspaceId: workspaceIdProp, parentTaskId: parentTaskIdProp, environmentId: environmentIdProp }: Props): JSX.Element {
  const { tasks, workspaces, personas, createTask, updateTask } = useGrackle();
  const { showToast } = useToast();
  const navigate = useAppNavigate();

  const isEdit = mode === "edit";
  const existingTask = isEdit && taskId ? tasks.find((t) => t.id === taskId) : undefined;

  const initialWorkspaceId = isEdit
    ? (existingTask?.workspaceId ?? "")
    : (workspaceIdProp ?? "");

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(initialWorkspaceId);
  const workspaceId = initialWorkspaceId || selectedWorkspaceId;

  /** Resolve environmentId from prop, or from the workspace's environmentId. */
  const resolvedWorkspace = workspaces.find((w) => w.id === workspaceId);
  const environmentId = environmentIdProp ?? resolvedWorkspace?.environmentId;

  /** Whether the workspace dropdown should be shown (new mode without pre-set workspace). */
  const showWorkspaceSelector = !isEdit && !workspaceIdProp;

  const parentTaskId = isEdit
    ? (existingTask?.parentTaskId ?? "")
    : (parentTaskIdProp ?? "");

  const parentTask = parentTaskId ? tasks.find((t) => t.id === parentTaskId) : undefined;

  const [title, setTitle] = useState(existingTask?.title ?? "");
  const [description, setDescription] = useState(existingTask?.description ?? "");
  const [selectedDeps, setSelectedDeps] = useState<string[]>(existingTask?.dependsOn ?? []);
  const [defaultPersonaId, setDefaultPersonaId] = useState(existingTask?.defaultPersonaId ?? "");
  const [canDecompose, setCanDecompose] = useState(existingTask?.canDecompose ?? false);
  const [creating, setCreating] = useState(false);

  // In edit mode, tasks may not have loaded yet at mount time. Sync form state
  // the first time existingTask becomes available so the form is pre-populated,
  // but do not re-apply on subsequent refreshes — that would discard in-progress
  // user edits whenever a background update replaces the task object.
  const hasHydratedRef = useRef(false);
  useEffect(() => {
    if (isEdit && existingTask && !hasHydratedRef.current) {
      hasHydratedRef.current = true;
      setTitle(existingTask.title);
      setDescription(existingTask.description);
      setSelectedDeps(existingTask.dependsOn);
      setDefaultPersonaId(existingTask.defaultPersonaId);
      setCanDecompose(existingTask.canDecompose);
    }
  }, [isEdit, existingTask]);

  // All tasks in the same workspace, excluding the task being edited (self)
  const siblingTasks = tasks.filter(
    (t) =>
      t.workspaceId === workspaceId &&
      (!isEdit || t.id !== taskId) &&
      t.id !== parentTaskId,
  );

  // In edit mode, also require that task data has loaded before allowing save
  // to prevent overwriting server data with blank form values.
  // Workspace is required: the user must pick one from the dropdown.
  const canSave = title.trim().length > 0
    && (!isEdit || existingTask !== undefined)
    && workspaceId.length > 0;

  const toggleDep = (depId: string): void => {
    setSelectedDeps((prev) =>
      prev.includes(depId) ? prev.filter((d) => d !== depId) : [...prev, depId],
    );
  };

  const handleSave = (): void => {
    if (!canSave || creating) {
      return;
    }
    if (isEdit && existingTask === undefined) {
      // Guard: task data not yet loaded — do not overwrite with blank values.
      return;
    }
    if (isEdit && taskId) {
      updateTask(taskId, title.trim(), description, selectedDeps, defaultPersonaId);
      showToast("Task updated", "success");
      navigate(taskUrl(taskId, undefined, workspaceId, environmentId), { replace: true });
    } else {
      setCreating(true);
      createTask(
        workspaceId,
        title.trim(),
        description,
        selectedDeps.length > 0 ? selectedDeps : undefined,
        parentTaskId || undefined,
        defaultPersonaId,
        canDecompose,
        () => {
          showToast("Task created", "success");
          navigate(workspaceIdProp && environmentId ? workspaceUrl(workspaceIdProp, environmentId) : "/tasks", { replace: true });
        },
        (message: string) => {
          showToast(message, "error");
          setCreating(false);
        },
      );
    }
  };

  const handleCancel = (): void => {
    if (isEdit && taskId) {
      navigate(taskUrl(taskId, undefined, workspaceId, environmentId));
    } else {
      navigate(workspaceIdProp && environmentId ? workspaceUrl(workspaceIdProp, environmentId) : "/tasks");
    }
  };

  const modeLabel = isEdit ? "edit task" : (parentTaskId ? "child task" : "new task");

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <span className={styles.badge}>{modeLabel}</span>
          {parentTask && (
            <span className={styles.parentContext}>
              <span className={styles.parentLabel}>Child of</span>
              <span className={styles.parentName}>{parentTask.title}</span>
            </span>
          )}
        </div>
        <div className={styles.headerActions}>
          <button
            onClick={handleSave}
            disabled={!canSave || creating}
            className={styles.btnPrimary}
            data-testid="task-edit-save"
          >
            {creating ? "Creating\u2026" : isEdit ? "Save Changes" : "Create"}
          </button>
          <button onClick={handleCancel} className={styles.btnGhost}>
            Cancel
          </button>
        </div>
      </div>

      {/* Form body */}
      <div className={styles.body}>
        <div className={styles.formContent}>
          {/* Workspace selector (shown when creating from global Tasks view) */}
          {showWorkspaceSelector && (
            <div className={styles.section}>
              <label className={styles.label} htmlFor="task-edit-workspace">
                Workspace
              </label>
              <select
                id="task-edit-workspace"
                value={selectedWorkspaceId}
                onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                className={styles.personaSelect}
                data-testid="task-edit-workspace"
              >
                <option value="">Select a workspace...</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Title */}
          <div className={styles.section}>
            <label className={styles.label} htmlFor="task-edit-title">
              Title
            </label>
            <input
              id="task-edit-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title..."
              autoFocus
              className={styles.titleInput}
              data-testid="task-edit-title"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSave) {
                  handleSave();
                }
              }}
            />
          </div>

          {/* Description */}
          <div className={styles.section}>
            <label className={styles.label} htmlFor="task-edit-description">
              Description
            </label>
            <textarea
              id="task-edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the task... (markdown supported)"
              className={styles.descriptionTextarea}
              data-testid="task-edit-description"
              rows={8}
            />
          </div>

          {/* Default Persona */}
          <div className={styles.section}>
            <label className={styles.label} htmlFor="task-edit-persona">
              Default Persona
            </label>
            <select
              id="task-edit-persona"
              value={defaultPersonaId}
              onChange={(e) => setDefaultPersonaId(e.target.value)}
              className={styles.personaSelect}
              data-testid="task-edit-persona"
            >
              <option value="">(Inherit)</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Can Decompose */}
          {!isEdit && (
            <div className={styles.section}>
              <label className={styles.depItem} data-testid="task-edit-can-decompose">
                <input
                  type="checkbox"
                  checked={canDecompose}
                  onChange={(e) => setCanDecompose(e.target.checked)}
                />
                Can spawn subtasks
              </label>
            </div>
          )}

          {/* Dependencies */}
          <div className={styles.section}>
            <div className={styles.label}>Dependencies</div>
            {siblingTasks.length === 0 ? (
              <div className={styles.noDeps}>No other tasks in this workspace</div>
            ) : (
              <div className={styles.depList}>
                {siblingTasks.map((t) => {
                  const isChecked = selectedDeps.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className={`${styles.depItem} ${isChecked ? styles.depItemSelected : ""}`}
                      data-testid={`dep-option-${t.id}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleDep(t.id)}
                      />
                      {t.title}
                      <span style={{ opacity: 0.5, fontSize: "11px", marginLeft: "4px" }}>
                        ({t.status})
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
