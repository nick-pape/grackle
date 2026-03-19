// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditableField } from "./useEditableField.js";

function makeOptions(overrides: Partial<Parameters<typeof useEditableField>[0]> = {}): Parameters<typeof useEditableField>[0] {
  return {
    value: "hello",
    onSave: vi.fn(),
    fieldId: "name",
    activeFieldId: null as string | null,
    onActivate: vi.fn(),
    ...overrides,
  };
}

describe("useEditableField", () => {
  // ── Lifecycle: start / cancel / save ──────────────────────────
  it("starts in non-editing state", () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useEditableField(opts));
    expect(result.current.isEditing).toBe(false);
    expect(result.current.draft).toBe("");
    expect(result.current.error).toBe("");
    expect(result.current.isDirty).toBe(false);
  });

  it("startEdit activates the field and seeds the draft", () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    expect(opts.onActivate).toHaveBeenCalledWith("name");
  });

  it("cancelEdit deactivates and clears state", () => {
    const opts = makeOptions({ activeFieldId: "name" });
    const { result } = renderHook(() => useEditableField(opts));

    // Seed draft
    act(() => result.current.startEdit());
    act(() => result.current.cancelEdit());

    expect(opts.onActivate).toHaveBeenLastCalledWith(null);
  });

  it("save calls onSave with trimmed value and exits", () => {
    const onSave = vi.fn();
    const opts = makeOptions({ value: "old", activeFieldId: "name", onSave });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    act(() => result.current.setDraft("  new  "));
    act(() => result.current.save());

    expect(onSave).toHaveBeenCalledWith("new");
    expect(opts.onActivate).toHaveBeenLastCalledWith(null);
  });

  it("save without trimOnSave preserves whitespace", () => {
    const onSave = vi.fn();
    const opts = makeOptions({ value: "old", activeFieldId: "name", onSave, trimOnSave: false });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    act(() => result.current.setDraft("  new  "));
    act(() => result.current.save());

    expect(onSave).toHaveBeenCalledWith("  new  ");
  });

  it("no-op save when value is unchanged", () => {
    const onSave = vi.fn();
    const opts = makeOptions({ value: "hello", activeFieldId: "name", onSave });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    // Draft is seeded with "hello" by startEdit, don't change it
    act(() => result.current.save());

    expect(onSave).not.toHaveBeenCalled();
    expect(opts.onActivate).toHaveBeenLastCalledWith(null); // Still exits edit mode
  });

  // ── Validation ────────────────────────────────────────────────
  it("save with validation error shows error and does not call onSave", () => {
    const onSave = vi.fn();
    const validate = vi.fn().mockReturnValue("Required");
    const opts = makeOptions({ value: "old", activeFieldId: "name", onSave, validate });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    act(() => result.current.setDraft(""));
    act(() => result.current.save());

    expect(result.current.error).toBe("Required");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("setDraft clears the error", () => {
    const validate = vi.fn().mockReturnValue("Required");
    const opts = makeOptions({ value: "old", activeFieldId: "name", validate });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    act(() => result.current.setDraft(""));
    act(() => result.current.save());
    expect(result.current.error).toBe("Required");

    act(() => result.current.setDraft("fixed"));
    expect(result.current.error).toBe("");
  });

  // ── isDirty ───────────────────────────────────────────────────
  it("isDirty is true when draft differs from value", () => {
    const opts = makeOptions({ value: "hello", activeFieldId: "name" });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    act(() => result.current.setDraft("changed"));
    expect(result.current.isDirty).toBe(true);
  });

  it("isDirty is false when draft matches value (after trim)", () => {
    const opts = makeOptions({ value: "hello", activeFieldId: "name" });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    act(() => result.current.setDraft("  hello  "));
    expect(result.current.isDirty).toBe(false);
  });

  it("isDirty is false when not editing", () => {
    const opts = makeOptions({ value: "hello", activeFieldId: null });
    const { result } = renderHook(() => useEditableField(opts));
    expect(result.current.isDirty).toBe(false);
  });

  // ── Keyboard handling ─────────────────────────────────────────
  it("Escape cancels edit", () => {
    const opts = makeOptions({ activeFieldId: "name" });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    act(() => {
      result.current.handleKeyDown({ key: "Escape" } as React.KeyboardEvent);
    });

    expect(opts.onActivate).toHaveBeenLastCalledWith(null);
  });

  it("Enter saves when enterToSave is true", () => {
    const onSave = vi.fn();
    const opts = makeOptions({ value: "old", activeFieldId: "name", onSave, enterToSave: true });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    act(() => result.current.setDraft("new"));
    act(() => {
      result.current.handleKeyDown({ key: "Enter" } as React.KeyboardEvent);
    });

    expect(onSave).toHaveBeenCalledWith("new");
  });

  it("Enter does NOT save when enterToSave is false", () => {
    const onSave = vi.fn();
    const opts = makeOptions({ value: "old", activeFieldId: "name", onSave, enterToSave: false });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    act(() => result.current.setDraft("new"));
    act(() => {
      result.current.handleKeyDown({ key: "Enter" } as React.KeyboardEvent);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  // ── Blur guard ────────────────────────────────────────────────
  it("ignoreInitialBlurRef prevents first blur from saving", () => {
    const onSave = vi.fn();
    const opts = makeOptions({ value: "old", activeFieldId: "name", onSave });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    expect(result.current.ignoreInitialBlurRef.current).toBe(true);

    // Simulate first blur — should be ignored
    act(() => {
      result.current.handleBlur({ relatedTarget: null } as unknown as React.FocusEvent);
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.ignoreInitialBlurRef.current).toBe(false);
  });

  it("blur with data-edit-action matching fieldId is ignored", () => {
    const onSave = vi.fn();
    const opts = makeOptions({ value: "old", activeFieldId: "name", onSave });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    // Clear the initial blur guard
    result.current.ignoreInitialBlurRef.current = false;

    // Simulate blur to a related element with matching data-edit-action
    const relatedTarget = document.createElement("button");
    relatedTarget.dataset.editAction = "name";

    act(() => {
      result.current.handleBlur({ relatedTarget } as unknown as React.FocusEvent);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("blur to unrelated element triggers save", () => {
    const onSave = vi.fn();
    const opts = makeOptions({ value: "old", activeFieldId: "name", onSave });
    const { result } = renderHook(() => useEditableField(opts));

    act(() => result.current.startEdit());
    result.current.ignoreInitialBlurRef.current = false;
    act(() => result.current.setDraft("new"));

    act(() => {
      result.current.handleBlur({ relatedTarget: null } as unknown as React.FocusEvent);
    });

    expect(onSave).toHaveBeenCalledWith("new");
  });
});
