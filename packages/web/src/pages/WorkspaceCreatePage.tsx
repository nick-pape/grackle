import { useEffect, useState, type JSX } from "react";
import { useSearchParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { Breadcrumbs, HOME_URL, Spinner, WorkspaceFormFields, defaultFormValues, environmentUrl, useAppNavigate, useToast } from "@grackle-ai/web-components";
import type { BreadcrumbSegment, WorkspaceFormValues } from "@grackle-ai/web-components";
import styles from "./form-layout.module.scss";

/** Validate workspace form values and return field errors (if any). */
function validate(v: WorkspaceFormValues): Partial<Record<keyof WorkspaceFormValues, string>> | undefined {
  const errs: Partial<Record<keyof WorkspaceFormValues, string>> = {};
  if (!v.name.trim()) {
    errs.name = "Name is required";
  }
  if (v.repoUrl.trim() && !/^https?:\/\/.+/i.test(v.repoUrl.trim())) {
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

  const { environments: { environments }, personas: { personas }, workspaces: { createWorkspace, workspaceCreating } } = useGrackle();
  const { showToast } = useToast();
  const navigate = useAppNavigate();

  const [values, setValues] = useState<WorkspaceFormValues>(() =>
    defaultFormValues(undefined, presetEnvironmentId || environments[0]?.id),
  );
  const [errors, setErrors] = useState<Partial<Record<keyof WorkspaceFormValues, string>> | undefined>();
  const [submitError, setSubmitError] = useState<string | undefined>();

  useEffect(() => {
    if (presetEnvironmentId || values.environmentId || environments.length === 0) {
      return;
    }
    setValues((currentValues) => {
      if (currentValues.environmentId) {
        return currentValues;
      }
      return {
        ...currentValues,
        environmentId: environments[0]?.id ?? "",
      };
    });
  }, [environments, presetEnvironmentId, values.environmentId]);

  const handleSave = (): void => {
    const errs = validate(values);
    if (errs) {
      setErrors(errs);
      setSubmitError(undefined);
      return;
    }
    setErrors(undefined);
    setSubmitError(undefined);
    createWorkspace(
      values.name.trim(),
      values.description,
      values.repoUrl.trim(),
      values.environmentId,
      values.defaultPersonaId,
      values.useWorktrees,
      values.workingDirectory,
      () => {
        showToast("Workspace created", "success");
        navigate(HOME_URL, { replace: true });
      },
      (message: string) => {
        setSubmitError(message);
      },
    ).catch(() => {});
  };

  const handleCancel = (): void => {
    navigate(presetEnvironmentId ? environmentUrl(presetEnvironmentId) : HOME_URL, { replace: true });
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
          onChange={(v) => { setValues(v); setErrors(undefined); setSubmitError(undefined); }}
          environments={environments}
          personas={personas}
          errors={errors}
          disabled={workspaceCreating}
          autoFocusName
        />
        {submitError && <div className={styles.error} data-testid="workspace-create-submit-error">{submitError}</div>}
      </div>
    </div>
  );
}
