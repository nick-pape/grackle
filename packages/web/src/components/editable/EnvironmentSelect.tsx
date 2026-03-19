import { type JSX, type ReactNode } from "react";
import { EditableSelect } from "./EditableSelect.js";
import type { Environment } from "../../hooks/useGrackleSocket.js";
import styles from "./EnvironmentSelect.module.scss";

/** Props for EnvironmentSelect. */
export interface EnvironmentSelectProps {
  /** Currently selected environment ID. */
  value: string;
  /** Called when the user selects a new environment. */
  onSave: (envId: string) => void;
  /** Available environments. */
  environments: Environment[];
  /** Whether to include a "None" option. */
  allowNone?: boolean;
  /** Unique field identifier for coordination with other editable fields. */
  fieldId?: string;
  /** Which field is currently being edited (parent coordination). */
  activeFieldId?: string | null; // eslint-disable-line @rushstack/no-new-null
  /** Callback to tell the parent which field is active. */
  onActivate?: (fieldId: string | null) => void; // eslint-disable-line @rushstack/no-new-null
  /** Placeholder text when no value is selected. */
  placeholder?: string;
  /** Accessible label. */
  ariaLabel?: string;
  /** Base test ID. */
  "data-testid"?: string;
}

/** Map environment status to a CSS class for the status dot. */
function envStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "ready" || s === "running" || s === "available" || s === "connected") return styles.envDotGreen;
  if (s === "provisioning" || s === "starting" || s === "pending" || s === "connecting") return styles.envDotYellow;
  if (s === "error" || s === "failed" || s === "disconnected") return styles.envDotRed;
  return styles.envDotGray;
}

/** Reusable environment selector with status dot display. Click-to-edit EditableSelect. */
export function EnvironmentSelect(props: EnvironmentSelectProps): JSX.Element {
  const {
    value,
    onSave,
    environments,
    allowNone = false,
    fieldId = "environment",
    activeFieldId,
    onActivate,
    placeholder = "No environment",
    ariaLabel = "Environment",
    "data-testid": testId,
  } = props;

  const selectedEnv = environments.find((e) => e.id === value);

  const options = [
    ...(allowNone ? [{ value: "", label: "None" }] : []),
    ...environments.map((env) => ({ value: env.id, label: env.displayName })),
  ];

  const renderDisplay = (): ReactNode | undefined => {
    if (selectedEnv) {
      return (
        <span className={styles.envRow}>
          <span className={`${styles.envDot} ${envStatusClass(selectedEnv.status)}`} />
          {selectedEnv.displayName}
        </span>
      );
    }
    return undefined;
  };

  return (
    <EditableSelect
      value={value}
      onSave={onSave}
      options={options}
      fieldId={fieldId}
      activeFieldId={activeFieldId}
      onActivate={onActivate}
      renderDisplay={renderDisplay}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      data-testid={testId}
    />
  );
}
