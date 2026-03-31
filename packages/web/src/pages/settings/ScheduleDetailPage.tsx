import { useState, useEffect, type JSX, type FormEvent } from "react";
import { useParams, Navigate } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import { Breadcrumbs, Button, ConfirmDialog, EditableSelect, EditableTextField, SCHEDULES_URL, SETTINGS_URL, scheduleUrl, useAppNavigate, useToast } from "@grackle-ai/web-components";
import type { BreadcrumbSegment, ScheduleData, ScheduleUpdate, SelectOption } from "@grackle-ai/web-components";
import { formatRelativeTime, formatCountdown } from "@grackle-ai/web-components";
import styles from "./ScheduleDetail.module.scss";

/** ScheduleDetailPage handles both create (/settings/schedules/new) and edit (/settings/schedules/:scheduleId). */
export function ScheduleDetailPage(): JSX.Element {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useAppNavigate();
  const { showToast } = useToast();
  const {
    schedules: { schedules, createSchedule, updateSchedule, deleteSchedule },
    personas: { personas },
    environments: { environments },
    workspaces: { workspaces },
  } = useGrackle();

  const isNew = scheduleId === undefined;
  const existing: ScheduleData | undefined = isNew ? undefined : schedules.find((s) => s.id === scheduleId);

  // Redirect to list if schedule not found (and schedules have loaded)
  if (!isNew && schedules.length > 0 && !existing) {
    return <Navigate to={SCHEDULES_URL} replace />;
  }

  const breadcrumbs: BreadcrumbSegment[] = [
    { label: "Settings", url: SETTINGS_URL },
    { label: "Schedules", url: SCHEDULES_URL },
    { label: isNew ? "New Schedule" : (existing?.title ?? "Schedule"), url: undefined },
  ];

  return (
    <div className={styles.container}>
      <Breadcrumbs segments={breadcrumbs} />
      <ScheduleForm
        existing={existing}
        isNew={isNew}
        personas={personas}
        environments={environments}
        workspaces={workspaces}
        onCreateSchedule={createSchedule}
        onUpdateSchedule={updateSchedule}
        onDeleteSchedule={deleteSchedule}
        onDone={() => { navigate(SCHEDULES_URL); }}
        showToast={showToast}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal form component
// ---------------------------------------------------------------------------

interface ScheduleFormProps {
  existing: ScheduleData | undefined;
  isNew: boolean;
  personas: Array<{ id: string; name: string }>;
  environments: Array<{ id: string; displayName: string }>;
  workspaces: Array<{ id: string; name: string }>;
  onCreateSchedule: (
    title: string, description: string, scheduleExpression: string,
    personaId: string, environmentId?: string, workspaceId?: string, parentTaskId?: string,
  ) => Promise<ScheduleData>;
  onUpdateSchedule: (scheduleId: string, fields: ScheduleUpdate) => Promise<ScheduleData>;
  onDeleteSchedule: (scheduleId: string) => Promise<void>;
  onDone: () => void;
  showToast: (message: string, type: "success" | "error") => void;
}

function ScheduleForm({
  existing, isNew,
  personas, environments, workspaces,
  onCreateSchedule, onUpdateSchedule, onDeleteSchedule,
  onDone, showToast,
}: ScheduleFormProps): JSX.Element {
  const navigate = useAppNavigate();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [scheduleExpression, setScheduleExpression] = useState(existing?.scheduleExpression ?? "");
  const [personaId, setPersonaId] = useState(existing?.personaId ?? "");
  const [environmentId, setEnvironmentId] = useState(existing?.environmentId ?? "");
  const [workspaceId, setWorkspaceId] = useState(existing?.workspaceId ?? "");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

  // Hydrate form when existing schedule loads asynchronously
  const [hydrated, setHydrated] = useState(!!isNew);
  useEffect(() => {
    if (!isNew && existing && !hydrated) {
      setHydrated(true);
      setTitle(existing.title);
      setDescription(existing.description);
      setScheduleExpression(existing.scheduleExpression);
      setPersonaId(existing.personaId);
      setEnvironmentId(existing.environmentId);
      setWorkspaceId(existing.workspaceId);
    }
  }, [isNew, existing, hydrated]);

  const isLoadingExisting = !isNew && existing === undefined;
  const canCreate = isNew && title.trim().length > 0 && scheduleExpression.trim().length > 0 && personaId.length > 0;

  const personaOptions: SelectOption[] = personas.map((p) => ({ value: p.id, label: p.name }));
  const environmentOptions: SelectOption[] = [
    { value: "", label: "Auto-select (first connected)" },
    ...environments.map((e) => ({ value: e.id, label: e.displayName })),
  ];
  const workspaceOptions: SelectOption[] = [
    { value: "", label: "System-level (no workspace)" },
    ...workspaces.map((w) => ({ value: w.id, label: w.name })),
  ];

  const handleCreateSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCreate) {
      return;
    }
    onCreateSchedule(title, description, scheduleExpression, personaId, environmentId || undefined, workspaceId || undefined).then(
      (created) => {
        showToast("Schedule created", "success");
        navigate(scheduleUrl(created.id), { replace: true });
      },
      () => {
        showToast("Failed to create schedule", "error");
      },
    );
  };

  const handleFieldSave = (field: keyof ScheduleUpdate, value: string | boolean): void => {
    if (!existing) {
      return;
    }
    onUpdateSchedule(existing.id, { [field]: value }).then(
      () => {
        showToast("Schedule updated", "success");
        if (field === "title") { setTitle(String(value)); }
        if (field === "description") { setDescription(String(value)); }
        if (field === "scheduleExpression") { setScheduleExpression(String(value)); }
        if (field === "personaId") { setPersonaId(String(value)); }
        if (field === "environmentId") { setEnvironmentId(String(value)); }
      },
      () => {
        showToast("Failed to update schedule", "error");
      },
    );
  };

  const handleToggleEnabled = (): void => {
    if (!existing) {
      return;
    }
    const nextEnabled = !existing.enabled;
    onUpdateSchedule(existing.id, { enabled: nextEnabled }).then(
      () => {
        showToast(nextEnabled ? "Schedule enabled" : "Schedule disabled", "success");
      },
      () => {
        showToast("Failed to update schedule", "error");
      },
    );
  };

  const handleDelete = (): void => {
    if (!existing) {
      return;
    }
    onDeleteSchedule(existing.id).then(
      () => {
        showToast("Schedule deleted", "success");
        onDone();
      },
      () => {
        showToast("Failed to delete schedule", "error");
      },
    );
  };

  return (
    <>
      {isLoadingExisting ? (
        <div className={styles.form}>
          <h3>Edit Schedule</h3>
          <p>Loading schedule...</p>
        </div>
      ) : isNew ? (
        <form onSubmit={handleCreateSubmit} className={styles.form}>
          <h3>Create Schedule</h3>
          <label>
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Nightly Review"
              required
              data-testid="schedule-detail-title"
            />
          </label>
          <label>
            Description <span className={styles.optional}>(optional)</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description..."
              data-testid="schedule-detail-description"
            />
          </label>
          <label>
            Schedule Expression
            <input
              type="text"
              value={scheduleExpression}
              onChange={(e) => setScheduleExpression(e.target.value)}
              placeholder="e.g. 30s, 5m, 1h, or 0 9 * * MON"
              required
              data-testid="schedule-detail-expression"
            />
            <p className={styles.helperText}>
              Interval: <code>30s</code>, <code>5m</code>, <code>1h</code>, <code>1d</code> (min 10s) &nbsp;|&nbsp;
              Cron: <code>0 9 * * MON</code> (standard 5-field cron syntax)
            </p>
          </label>
          <label>
            Persona
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              required
              data-testid="schedule-detail-persona"
            >
              <option value="">Select a persona...</option>
              {personaOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label>
            Environment <span className={styles.optional}>(optional)</span>
            <select value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)} data-testid="schedule-detail-environment">
              {environmentOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label>
            Workspace <span className={styles.optional}>(optional)</span>
            <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} data-testid="schedule-detail-workspace">
              {workspaceOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <div className={styles.formActions}>
            <Button type="submit" variant="primary" size="md" disabled={!canCreate} data-testid="schedule-detail-save">
              Create
            </Button>
            <Button type="button" variant="outline" size="md" onClick={onDone} data-testid="schedule-detail-cancel">
              Cancel
            </Button>
          </div>
        </form>
      ) : existing ? (
        <div className={styles.form}>
          <h3>Edit Schedule</h3>
          <div className={styles.formActions}>
            <Button type="button" variant="outline" size="md" onClick={onDone} data-testid="schedule-detail-cancel">
              Back to Schedules
            </Button>
            <Button
              type="button"
              variant={existing.enabled ? "ghost" : "primary"}
              size="md"
              onClick={handleToggleEnabled}
              data-testid="schedule-detail-toggle"
            >
              {existing.enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              type="button"
              variant="danger"
              size="md"
              onClick={() => setShowDeleteConfirm(true)}
              data-testid="schedule-detail-delete"
            >
              Delete
            </Button>
          </div>

          <div className={styles.editableSection}>
            <label>
              Title
              <EditableTextField
                value={title}
                onSave={(value) => { handleFieldSave("title", value); }}
                validate={(value) => (value.trim() ? undefined : "Title is required")}
                fieldId="schedule-title"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                ariaLabel="Schedule title"
                data-testid="schedule-detail-title"
              />
            </label>
            <label>
              Description
              <EditableTextField
                value={description}
                onSave={(value) => { handleFieldSave("description", value); }}
                fieldId="schedule-description"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder="Brief description..."
                ariaLabel="Schedule description"
                data-testid="schedule-detail-description"
              />
            </label>
            <label>
              Schedule Expression
              <EditableTextField
                value={scheduleExpression}
                onSave={(value) => { handleFieldSave("scheduleExpression", value); }}
                validate={(value) => (value.trim() ? undefined : "Schedule expression is required")}
                fieldId="schedule-expression"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                placeholder="e.g. 30s, 5m, 1h, or 0 9 * * MON"
                ariaLabel="Schedule expression"
                data-testid="schedule-detail-expression"
              />
            </label>
            <label>
              Persona
              <EditableSelect
                value={personaId}
                onSave={(value) => { handleFieldSave("personaId", value); }}
                options={personaOptions}
                fieldId="schedule-persona"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                ariaLabel="Schedule persona"
                data-testid="schedule-detail-persona"
              />
            </label>
            <label>
              Environment <span className={styles.optional}>(optional — empty = auto-select)</span>
              <EditableSelect
                value={environmentId}
                onSave={(value) => { handleFieldSave("environmentId", value); }}
                options={environmentOptions}
                fieldId="schedule-environment"
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                ariaLabel="Schedule environment"
                data-testid="schedule-detail-environment"
              />
            </label>
          </div>

          <div className={styles.metaSection}>
            {existing.lastRunAt ? (
              <span>Last run: {formatRelativeTime(existing.lastRunAt)}</span>
            ) : (
              <span>Last run: Never</span>
            )}
            {existing.enabled && existing.nextRunAt ? (
              <span>Next run: {formatCountdown(existing.nextRunAt)}</span>
            ) : null}
            {existing.runCount > 0 && <span>Total runs: {existing.runCount}</span>}
            <span>Created: {formatRelativeTime(existing.createdAt)}</span>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Schedule?"
        description={`"${existing?.title}" will be permanently removed. Tasks already created by this schedule will not be affected.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
