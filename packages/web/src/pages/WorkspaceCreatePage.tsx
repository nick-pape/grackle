import { useState, type JSX } from "react";
import { useSearchParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { useToast } from "../context/ToastContext.js";
import { Breadcrumbs, Spinner } from "../components/display/index.js";
import { HOME_URL, useAppNavigate } from "../utils/navigation.js";
import {
  WorkspaceFormFields,
  defaultFormValues,
  type WorkspaceFormValues,
} from "../components/workspace/WorkspaceFormFields.js";
import type { BreadcrumbSegment } from "../utils/breadcrumbs.js";
import styles from "../components/panels/TaskEditPanel.module.scss";

/** Validate workspace form values and return field errors (if any). */
function validate(v: WorkspaceFormValues): Partial<Record<keyof WorkspaceFormValues, string>> | undefined {
  const errs: Partial<Record<keyof WorkspaceFormValues, string>> = {};
  if (!v.name.trim()) {
    errs.name = "Name is required";
  }
  if (v.repoUrl.trim() && !/^https?:\/\/.+/.test(v.repoUrl.trim())) {
    errs.repoUrl = "Must be a valid http(s) URL";
  }
  if (!v.environmentId) {
    errs.environmentId = "Environment is required";
  }
  return Object.keys(errs).length > 0 ? errs : undefined;
}

const breadcrumbs: BreadcrumbSegment[] = [
  { label: "Home", url: HOME_URL },
  { label: "New Workspace", url: undefined },
];

/** Full-page workspace creation form. */
export function WorkspaceCreatePage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const presetEnvironmentId = searchParams.get("environment") ?? undefined;

  const { environments, personas, createWorkspace, workspaceCreating } = useGrackle();
  const { showToast } = useToast();
  const navigate = useAppNavigate();

  const [values, setValues] = useState<WorkspaceFormValues>(() =>
    defaultFormValues(undefined, presetEnvironmentId || environments[0]?.id),
  );
  const [errors, setErrors] = useState<Partial<Record<keyof WorkspaceFormValues, string>> | undefined>();

  const handleSave = (): void => {
    const errs = validate(values);
    if (errs) {
      setErrors(errs);
      return;
    }
    setErrors(undefined);
    createWorkspace(
      values.name.trim(),
      values.description,
      values.repoUrl,
      values.environmentId,
      values.defaultPersonaId,
      values.useWorktrees,
      values.worktreeBasePath,
    );
    showToast("Workspace created", "success");
    navigate(HOME_URL, { replace: true });
  };

  const handleCancel = (): void => {
    navigate(-1);
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Breadcrumbs segments={breadcrumbs} />
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.btnGhost}
            onClick={handleCancel}
            disabled={workspaceCreating}
            data-testid="workspace-create-cancel"
          >
            Cancel
          </button>
          <button
            className={styles.btnPrimary}
            onClick={handleSave}
            disabled={workspaceCreating || !values.name.trim() || !values.environmentId}
            data-testid="workspace-create-save"
          >
            {workspaceCreating ? <Spinner size="sm" label="Creating" /> : "Create Workspace"}
          </button>
        </div>
      </div>

      {/* Form body */}
      <div className={styles.body}>
        <WorkspaceFormFields
          values={values}
          onChange={(v) => { setValues(v); setErrors(undefined); }}
          environments={environments}
          personas={personas}
          errors={errors}
          disabled={workspaceCreating}
        />
      </div>
    </div>
  );
}
