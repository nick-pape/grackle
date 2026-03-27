import { useCallback, useEffect, useRef, type JSX, type ReactNode } from "react";
import { useEditableField } from "./useEditableField.js";
import styles from "./EditableField.module.scss";

/** A single option in the select dropdown. */
export interface SelectOption {
  value: string;
  label: string;
}

/** Props for EditableSelect. */
export interface EditableSelectProps {
  /** Current persisted value. */
  value: string;
  /** Called when the user selects a new value. Required in edit mode. */
  onSave: (value: string) => void;
  /** "edit" (default) for click-to-edit, "create" for always-visible. */
  mode?: "edit" | "create";
  /** Available options for the dropdown. */
  options: SelectOption[];
  /** Unique field identifier for coordination. */
  fieldId?: string;
  /** Which field is currently being edited (parent coordination). */
  activeFieldId?: string | null; // eslint-disable-line @rushstack/no-new-null
  /** Callback to tell the parent which field is active. */
  onActivate?: (fieldId: string | null) => void; // eslint-disable-line @rushstack/no-new-null
  /** Called on change in create mode. */
  onChange?: (value: string) => void;
  /** Custom display renderer for the selected value. */
  renderDisplay?: (value: string) => ReactNode | undefined;
  /** Placeholder text when no value is selected. */
  placeholder?: string;
  /** Accessible label for the select. */
  ariaLabel?: string;
  /** Base test ID — gets `-select` / `-button` suffixes appended. */
  "data-testid"?: string;
}

/** Reusable click-to-edit select dropdown. */
export function EditableSelect(props: EditableSelectProps): JSX.Element {
  const {
    value,
    onSave,
    mode = "edit",
    options,
    fieldId = "select",
    activeFieldId,
    onActivate,
    onChange,
    renderDisplay,
    placeholder,
    ariaLabel,
    "data-testid": testId,
  } = props;

  const selectRef = useRef<HTMLSelectElement>(null);

  const field = useEditableField({
    value,
    onSave,
    fieldId,
    activeFieldId,
    onActivate,
    enterToSave: false,
    trimOnSave: false,
  });

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (field.isEditing) {
      const timer = window.setTimeout(() => {
        selectRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [field.isEditing]);

  /** Select saves immediately on change and exits edit mode. */
  const handleSelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value;
    field.ignoreInitialBlurRef.current = false;
    if (newValue !== value) {
      onSave(newValue);
    }
    field.cancelEdit();
  }, [value, onSave, field]);

  /** Blur just cancels (no auto-save for selects). */
  const handleSelectBlur = useCallback((event: React.FocusEvent) => {
    if (field.ignoreInitialBlurRef.current) {
      field.ignoreInitialBlurRef.current = false;
      return;
    }
    if (
      event.relatedTarget instanceof HTMLElement &&
      event.relatedTarget.dataset.editAction === fieldId
    ) {
      return;
    }
    field.cancelEdit();
  }, [fieldId, field]);

  // Create mode: always show select
  if (mode === "create") {
    return (
      <select
        className={styles.editSelect}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={ariaLabel}
        data-testid={testId ? `${testId}-select` : undefined}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }

  // Edit mode: show select dropdown
  if (field.isEditing) {
    return (
      <select
        ref={selectRef}
        className={styles.editSelect}
        value={field.draft}
        onChange={handleSelectChange}
        onBlur={handleSelectBlur}
        title={ariaLabel}
        aria-label={ariaLabel}
        data-testid={testId ? `${testId}-select` : undefined}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }

  // Display mode
  const displayContent = renderDisplay?.(value);
  const selectedLabel = options.find((o) => o.value === value)?.label;
  return (
    <button
      type="button"
      className={styles.metaValueClickable}
      onClick={() => field.startEdit()}
      title="Click to change"
      aria-label={ariaLabel}
      data-testid={testId ? `${testId}-button` : undefined}
    >
      {displayContent !== undefined ? displayContent : (
        selectedLabel ? (
          <span>{selectedLabel}</span>
        ) : (
          <span className={styles.metaPlaceholder}>{placeholder || "None"}</span>
        )
      )}
      <span className={styles.editButton} aria-hidden="true">
        &#x270F;&#xFE0F;
      </span>
    </button>
  );
}
