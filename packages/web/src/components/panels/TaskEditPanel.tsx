import { useState, useEffect, useRef, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { useToast } from "../../context/ToastContext.js";
import type { ViewMode } from "../../App.js";
import styles from "./TaskEditPanel.module.scss";

/** Props for the TaskEditPanel component. */
interface Props {
  viewMode: ViewMode & { kind: "new_task" | "edit_task" };
  setViewMode: (mode: ViewMode) => void;
}

/**
 * Full-panel create/edit form for tasks.
 *
 * - new_task: blank form; calls createTask on save, then navigates back to
 *             the project view.
 * - edit_task: pre-populated form; calls updateTask on save, then navigates
 *              back to the task overview.
 *
 * Environment is intentionally excluded — it is selected at task start time,
 * not at creation/editing time.
 */
export function TaskEditPanel({ viewMode, setViewMode }: Props): JSX.Element {
  const { tasks, createTask, updateTask, personas } = useGrackle();
  const { showToast } = useToast();

  const isEdit = viewMode.kind === "edit_task";
  const existingTask = isEdit ? tasks.find((t) => t.id === viewMode.taskId) : undefined;

  const projectId = isEdit
    ? (existingTask?.projectId ?? "")
    : viewMode.projectId;

  const parentTaskId = isEdit
    ? (existingTask?.parentTaskId ?? "")
    : (viewMode.kind === "new_task" ? (viewMode.parentTaskId ?? "") : "");

  const parentTask = parentTaskId ? tasks.find((t) => t.id === parentTaskId) : undefined;

  const [title, setTitle] = useState(existingTask?.title ?? "");
  const [description, setDescription] = useState(existingTask?.description ?? "");
  const [selectedDeps, setSelectedDeps] = useState<string[]>(existingTask?.dependsOn ?? []);
  const [personaId, setPersonaId] = useState(existingTask?.personaId ?? "");

  // In edit mode, tasks may not have loaded yet at mount time. Sync form state
  // the first time existingTask becomes available so the form is pre-populated,
  // but do not re-apply on subsequent refreshes — that would discard in-progress
  // user edits whenever a background update replaces the task object.
  const hasHydratedRef = useRef(false);
  useEffect(() => {
    if (isEdit && existingTask && !hasHydratedRef.current) {
      hasHydratedRef.current = true;
      setTitle(existingTask.title);
      setDescription(existingTask.description ?? "");
      setSelectedDeps(existingTask.dependsOn ?? []);
    }
  }, [isEdit, existingTask]);

  // All tasks in the same project, excluding the task being edited (self)
  const siblingTasks = tasks.filter(
    (t) =>
      t.projectId === projectId &&
      (!isEdit || t.id !== viewMode.taskId) &&
      t.id !== parentTaskId,
  );

  // In edit mode, also require that task data has loaded before allowing save
  // to prevent overwriting server data with blank form values.
  const canSave = title.trim().length > 0 && (!isEdit || existingTask !== undefined);

  const toggleDep = (depId: string): void => {
    setSelectedDeps((prev) =>
      prev.includes(depId) ? prev.filter((d) => d !== depId) : [...prev, depId],
    );
  };

  const handleSave = (): void => {
    if (!canSave) {
      return;
    }
    if (isEdit && existingTask === undefined) {
      // Guard: task data not yet loaded — do not overwrite with blank values.
      return;
    }
    if (isEdit) {
      updateTask(viewMode.taskId, title.trim(), description, selectedDeps);
      showToast("Task updated", "success");
      setViewMode({ kind: "task", taskId: viewMode.taskId });
    } else {
      createTask(
        projectId,
        title.trim(),
        description,
        "",
        selectedDeps.length > 0 ? selectedDeps : undefined,
        parentTaskId || undefined,
        personaId || undefined,
      );
      showToast("Task created", "success");
      setViewMode({ kind: "project", projectId });
    }
  };

  const handleCancel = (): void => {
    if (isEdit) {
      setViewMode({ kind: "task", taskId: viewMode.taskId });
    } else {
      setViewMode({ kind: "project", projectId });
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
            disabled={!canSave}
            className={styles.btnPrimary}
            data-testid="task-edit-save"
          >
            {isEdit ? "Save Changes" : "Create"}
          </button>
          <button onClick={handleCancel} className={styles.btnGhost}>
            Cancel
          </button>
        </div>
      </div>

      {/* Form body */}
      <div className={styles.body}>
      <div className={styles.formContent}>
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

        {/* Persona (new task only — persona is a creation-time template) */}
        {!isEdit && personas.length > 0 && (
          <div className={styles.section}>
            <label className={styles.label} htmlFor="task-edit-persona">
              Persona
            </label>
            <select
              id="task-edit-persona"
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              className={styles.personaSelect}
              data-testid="task-edit-persona"
            >
              <option value="">No persona</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Dependencies */}
        <div className={styles.section}>
          <div className={styles.label}>Dependencies</div>
          {siblingTasks.length === 0 ? (
            <div className={styles.noDeps}>No other tasks in this project</div>
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
