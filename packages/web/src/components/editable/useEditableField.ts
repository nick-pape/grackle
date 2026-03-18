import { useCallback, useEffect, useRef, useState } from "react";

/** Options for the useEditableField hook. */
export interface UseEditableFieldOptions {
  /** Current persisted value. */
  value: string;
  /** Called when the user saves a new value. */
  onSave: (value: string) => void;
  /** Optional validation — return an error string, or undefined if valid. */
  validate?: (value: string) => string | undefined;
  /** Unique identifier for this field (used for coordination). */
  fieldId: string;
  /** Which field is currently being edited (coordination from parent). */
  activeFieldId?: string | null; // eslint-disable-line @rushstack/no-new-null
  /** Callback to tell the parent which field is active. */
  onActivate?: (fieldId: string | null) => void; // eslint-disable-line @rushstack/no-new-null
  /** Whether Enter key triggers save (true for text inputs, false for textarea). */
  enterToSave?: boolean;
  /** Whether to trim whitespace before saving. Default true. */
  trimOnSave?: boolean;
}

/** Return type for the useEditableField hook. */
export interface UseEditableFieldReturn {
  /** Whether this field is currently in edit mode. */
  isEditing: boolean;
  /** The current draft value while editing. */
  draft: string;
  /** Validation error message, or empty string. */
  error: string;
  /** Whether the draft differs from the persisted value. */
  isDirty: boolean;
  /** Enter edit mode with the current value as the draft. */
  startEdit: () => void;
  /** Exit edit mode without saving. */
  cancelEdit: () => void;
  /** Validate and save the current draft. */
  save: () => void;
  /** Update the draft value. Also clears any validation error. */
  setDraft: (value: string) => void;
  /** Clear the validation error. */
  clearError: () => void;
  /** Blur handler that auto-saves, respecting ignoreInitialBlur and data-edit-action. */
  handleBlur: (event: React.FocusEvent) => void;
  /** Keyboard handler for Escape (cancel) and optionally Enter (save). */
  handleKeyDown: (event: React.KeyboardEvent) => void;
  /**
   * Ref that prevents the initial blur (caused by clicking the edit button)
   * from triggering a save. Set to true when startEdit is called, reset on
   * first blur.
   */
  ignoreInitialBlurRef: React.RefObject<boolean>;
}

/**
 * Shared hook that encapsulates the click-to-edit state machine used by
 * EditableTextField, EditableTextArea, and EditableSelect.
 */
export function useEditableField(options: UseEditableFieldOptions): UseEditableFieldReturn {
  const {
    value,
    onSave,
    validate,
    fieldId,
    activeFieldId,
    onActivate,
    enterToSave = true,
    trimOnSave = true,
  } = options;

  const [draft, setDraftRaw] = useState("");
  const [error, setError] = useState("");
  const ignoreInitialBlurRef = useRef<boolean>(false);

  const isEditing = activeFieldId === fieldId;

  const setDraft = useCallback((v: string) => {
    setDraftRaw(v);
    setError("");
  }, []);

  const clearError = useCallback(() => {
    setError("");
  }, []);

  const cancelEdit = useCallback(() => {
    ignoreInitialBlurRef.current = false;
    onActivate?.(null);
    setDraftRaw("");
    setError("");
  }, [onActivate]);

  const save = useCallback(() => {
    const saveValue = trimOnSave ? draft.trim() : draft;

    if (validate) {
      const validationError = validate(draft);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    // No-op when value hasn't changed
    const compareValue = trimOnSave ? value.trim() : value;
    if (saveValue === compareValue) {
      cancelEdit();
      return;
    }

    onSave(saveValue);
    cancelEdit();
  }, [draft, value, trimOnSave, validate, onSave, cancelEdit]);

  const startEdit = useCallback(() => {
    ignoreInitialBlurRef.current = true;
    onActivate?.(fieldId);
    setDraftRaw(value);
    setError("");
  }, [fieldId, value, onActivate]);

  const handleBlur = useCallback((event: React.FocusEvent) => {
    if (ignoreInitialBlurRef.current) {
      ignoreInitialBlurRef.current = false;
      return;
    }
    if (
      event.relatedTarget instanceof HTMLElement &&
      event.relatedTarget.dataset.editAction === fieldId
    ) {
      return;
    }
    save();
  }, [fieldId, save]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      cancelEdit();
    } else if (event.key === "Enter" && enterToSave) {
      save();
    }
  }, [cancelEdit, enterToSave, save]);

  const isDirty = (() => {
    if (!isEditing) return false;
    const compareValue = trimOnSave ? value.trim() : value;
    const draftValue = trimOnSave ? draft.trim() : draft;
    return draftValue !== compareValue;
  })();

  // If another field becomes active, reset our local state
  useEffect(() => {
    if (!isEditing && (draft !== "" || error !== "")) {
      setDraftRaw("");
      setError("");
    }
  }, [isEditing, draft, error]);

  return {
    isEditing,
    draft,
    error,
    isDirty,
    startEdit,
    cancelEdit,
    save,
    setDraft,
    clearError,
    handleBlur,
    handleKeyDown,
    ignoreInitialBlurRef,
  };
}
