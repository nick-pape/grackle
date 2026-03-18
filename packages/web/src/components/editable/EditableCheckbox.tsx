import type { JSX } from "react";
import styles from "./EditableField.module.scss";

/** Props for EditableCheckbox. */
export interface EditableCheckboxProps {
  /** Whether the checkbox is checked. */
  checked: boolean;
  /** Called when the checkbox value changes. */
  onChange: (checked: boolean) => void;
  /** Label text displayed next to the checkbox. */
  label: string;
  /** Accessible label for the checkbox. */
  ariaLabel?: string;
  /** Test ID for the wrapping label element. */
  "data-testid"?: string;
}

/** Simple checkbox toggle — no edit/display mode, always interactive. */
export function EditableCheckbox(props: EditableCheckboxProps): JSX.Element {
  const {
    checked,
    onChange,
    label,
    ariaLabel,
    "data-testid": testId,
  } = props;

  return (
    <label className={styles.worktreeToggle} data-testid={testId}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
      />
      <span>{label}</span>
    </label>
  );
}
