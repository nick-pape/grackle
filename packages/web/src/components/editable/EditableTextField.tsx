import { useEffect, useRef, type JSX, type ReactNode } from "react";
import { useEditableField } from "./useEditableField.js";
import styles from "./EditableField.module.scss";

/** Props for EditableTextField. */
export interface EditableTextFieldProps {
  /** Current persisted value. */
  value: string;
  /** Called when the user saves (edit mode). */
  onSave?: (value: string) => void;
  /** Optional validation — return an error string, or undefined if valid. */
  validate?: (value: string) => string | undefined;
  /** "edit" (default) for click-to-edit, "create" for always-editable. */
  mode?: "edit" | "create";
  /** Unique field identifier for coordination. */
  fieldId?: string;
  /** Which field is currently being edited (parent coordination). */
  activeFieldId?: string | null; // eslint-disable-line @rushstack/no-new-null
  /** Callback to tell the parent which field is active. */
  onActivate?: (fieldId: string | null) => void; // eslint-disable-line @rushstack/no-new-null
  /** Called on every keystroke in create mode. */
  onChange?: (value: string) => void;
  /** Custom display renderer (e.g., link for repoUrl). */
  renderDisplay?: (value: string) => ReactNode | undefined;
  /** Placeholder text shown when empty. */
  placeholder?: string;
  /** Max character length for the input. */
  maxLength?: number;
  /** Accessible label for the input. */
  ariaLabel?: string;
  /** Base test ID — gets `-input` / `-button` suffixes appended. */
  "data-testid"?: string;
}

/** Reusable click-to-edit text input field. */
export function EditableTextField(props: EditableTextFieldProps): JSX.Element {
  const {
    value,
    onSave,
    validate,
    mode = "edit",
    fieldId = "text",
    activeFieldId,
    onActivate,
    onChange,
    renderDisplay,
    placeholder,
    maxLength,
    ariaLabel,
    "data-testid": testId,
  } = props;

  const inputRef = useRef<HTMLInputElement>(null);

  const field = useEditableField({
    value,
    onSave: onSave ?? (() => {}),
    validate,
    fieldId,
    activeFieldId,
    onActivate,
    enterToSave: true,
    trimOnSave: true,
  });

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (field.isEditing) {
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [field.isEditing]);

  // Create mode: always show input, no blur-to-save
  if (mode === "create") {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
      onChange?.(e.target.value);
    };

    const validationError = validate?.(value);

    return (
      <div className={styles.editFieldWrapper}>
        <input
          className={`${styles.editInput} ${validationError ? styles.editInputInvalid : ""}`}
          value={value}
          onChange={handleChange}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={ariaLabel}
          data-testid={testId ? `${testId}-input` : undefined}
        />
        {validationError && (
          <span className={styles.editError} data-testid="edit-error">{validationError}</span>
        )}
      </div>
    );
  }

  // Edit mode: toggle between display and input
  if (field.isEditing) {
    return (
      <div className={styles.editFieldWrapper}>
        <input
          ref={inputRef}
          className={`${styles.editInput} ${field.error ? styles.editInputInvalid : ""}`}
          value={field.draft}
          onChange={(e) => field.setDraft(e.target.value)}
          onBlur={field.handleBlur}
          onKeyDown={field.handleKeyDown}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={ariaLabel}
          data-testid={testId ? `${testId}-input` : undefined}
        />
        {field.isDirty && <span className={styles.unsavedDot} title="Unsaved changes" />}
        {field.error && (
          <span className={styles.editError} data-testid="edit-error">{field.error}</span>
        )}
        <span className={styles.editHint}>Enter to save &middot; Esc to cancel</span>
      </div>
    );
  }

  // Display mode
  const displayContent = renderDisplay?.(value);
  return (
    <button
      type="button"
      className={styles.metaValueClickable}
      onClick={() => field.startEdit()}
      title={placeholder ? `Click to edit` : "Click to edit"}
      aria-label={ariaLabel ? `Edit ${ariaLabel.toLowerCase()}` : "Edit"}
      data-testid={testId ? `${testId}-button` : undefined}
    >
      {displayContent !== undefined ? displayContent : (
        value ? (
          <span>{value}</span>
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
