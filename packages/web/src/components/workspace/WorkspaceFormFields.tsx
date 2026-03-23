/**
 * Shared workspace form fields used by both the create page and the inline-edit
 * detail page. Each field renders its own label + input/control.
 *
 * @module
 */

import { type JSX } from "react";
import type { Workspace, Environment, PersonaData } from "../../hooks/types.js";
import styles from "./WorkspaceFormFields.module.scss";

/** Fields managed by the workspace form. */
export interface WorkspaceFormValues {
  name: string;
  description: string;
  repoUrl: string;
  environmentId: string;
  defaultPersonaId: string;
  useWorktrees: boolean;
  worktreeBasePath: string;
}

/** Build a blank set of defaults, optionally seeded from a workspace. */
export function defaultFormValues(ws?: Workspace, environmentId?: string): WorkspaceFormValues {
  return {
    name: ws?.name ?? "",
    description: ws?.description ?? "",
    repoUrl: ws?.repoUrl ?? "",
    environmentId: ws?.environmentId ?? environmentId ?? "",
    defaultPersonaId: ws?.defaultPersonaId ?? "",
    useWorktrees: ws?.useWorktrees ?? true,
    worktreeBasePath: ws?.worktreeBasePath ?? "",
  };
}

/** Props for {@link WorkspaceFormFields}. */
interface WorkspaceFormFieldsProps {
  values: WorkspaceFormValues;
  onChange: (values: WorkspaceFormValues) => void;
  environments: Environment[];
  personas: PersonaData[];
  /** Validation errors keyed by field name. */
  errors?: Partial<Record<keyof WorkspaceFormValues, string>>;
  /** Whether the form is in a submitting state. */
  disabled?: boolean;
  /** Whether the name field should receive autofocus on mount. */
  autoFocusName?: boolean;
}

const MAX_NAME_LENGTH: number = 100;

/** Shared form fields for workspace create/edit. */
export function WorkspaceFormFields({
  values,
  onChange,
  environments,
  personas,
  errors,
  disabled,
  autoFocusName,
}: WorkspaceFormFieldsProps): JSX.Element {
  const set = <K extends keyof WorkspaceFormValues>(key: K, val: WorkspaceFormValues[K]): void => {
    onChange({ ...values, [key]: val });
  };

  return (
    <div className={styles.formContent}>
      {/* Name */}
      <div className={styles.section}>
        <label className={styles.label} htmlFor="ws-name">Name</label>
        <input
          id="ws-name"
          className={styles.titleInput}
          type="text"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Workspace name"
          maxLength={MAX_NAME_LENGTH}
          autoFocus={autoFocusName}
          disabled={disabled}
          data-testid="workspace-form-name"
        />
        {errors?.name && <span className={styles.fieldError} data-testid="workspace-form-error-name">{errors.name}</span>}
      </div>

      {/* Description */}
      <div className={styles.section}>
        <label className={styles.label} htmlFor="ws-description">Description</label>
        <textarea
          id="ws-description"
          className={styles.descriptionTextarea}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Optional description (Markdown supported)"
          disabled={disabled}
          data-testid="workspace-form-description"
        />
      </div>

      {/* Repository URL */}
      <div className={styles.section}>
        <label className={styles.label} htmlFor="ws-repo">Repository URL</label>
        <input
          id="ws-repo"
          className={styles.titleInput}
          type="text"
          value={values.repoUrl}
          onChange={(e) => set("repoUrl", e.target.value)}
          placeholder="https://github.com/org/repo"
          disabled={disabled}
          data-testid="workspace-form-repo"
        />
        {errors?.repoUrl && <span className={styles.fieldError} data-testid="workspace-form-error-repoUrl">{errors.repoUrl}</span>}
      </div>

      {/* Environment */}
      <div className={styles.section}>
        <label className={styles.label} htmlFor="ws-environment">Environment</label>
        <select
          id="ws-environment"
          className={styles.selectField}
          value={values.environmentId}
          onChange={(e) => set("environmentId", e.target.value)}
          disabled={disabled}
          data-testid="workspace-form-environment"
        >
          <option value="">Select environment…</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.displayName || env.id}
            </option>
          ))}
        </select>
        {errors?.environmentId && <span className={styles.fieldError} data-testid="workspace-form-error-environmentId">{errors.environmentId}</span>}
      </div>

      {/* Default Persona */}
      <div className={styles.section}>
        <label className={styles.label} htmlFor="ws-persona">Default Persona</label>
        <select
          id="ws-persona"
          className={styles.selectField}
          value={values.defaultPersonaId}
          onChange={(e) => set("defaultPersonaId", e.target.value)}
          disabled={disabled}
          data-testid="workspace-form-persona"
        >
          <option value="">(Inherit)</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Worktree isolation */}
      <div className={styles.section}>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={values.useWorktrees}
            onChange={(e) => set("useWorktrees", e.target.checked)}
            disabled={disabled}
            data-testid="workspace-form-worktrees"
          />
          <span className={styles.checkboxLabel}>Enable worktree isolation</span>
        </label>
      </div>

      {/* Working directory */}
      <div className={styles.section}>
        <label className={styles.label} htmlFor="ws-workdir">Working Directory</label>
        <input
          id="ws-workdir"
          className={styles.titleInput}
          type="text"
          value={values.worktreeBasePath}
          onChange={(e) => set("worktreeBasePath", e.target.value)}
          placeholder="Default (server default)"
          disabled={disabled}
          data-testid="workspace-form-workdir"
        />
      </div>
    </div>
  );
}
