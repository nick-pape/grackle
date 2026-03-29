// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEnvironmentOperationToasts } from "./useEnvironmentOperationToasts.js";

describe("useEnvironmentOperationToasts", () => {
  it("does not fire toast when operationError is empty", () => {
    const showToast = vi.fn();
    const clearOperationError = vi.fn();
    renderHook(() => useEnvironmentOperationToasts("", clearOperationError, showToast));
    expect(showToast).not.toHaveBeenCalled();
    expect(clearOperationError).not.toHaveBeenCalled();
  });

  it("fires error toast when operationError becomes non-empty", () => {
    const showToast = vi.fn();
    const clearOperationError = vi.fn();
    const { rerender } = renderHook(
      ({ error }) => useEnvironmentOperationToasts(error, clearOperationError, showToast),
      { initialProps: { error: "" } },
    );
    rerender({ error: "Connection refused" });
    expect(showToast).toHaveBeenCalledWith("Connection refused", "error");
  });

  it("calls clearOperationError after toasting", () => {
    const showToast = vi.fn();
    const clearOperationError = vi.fn();
    const { rerender } = renderHook(
      ({ error }) => useEnvironmentOperationToasts(error, clearOperationError, showToast),
      { initialProps: { error: "" } },
    );
    rerender({ error: "Server error" });
    expect(clearOperationError).toHaveBeenCalled();
  });

  it("does not re-fire for same error on rerender", () => {
    const showToast = vi.fn();
    const clearOperationError = vi.fn();
    const { rerender } = renderHook(
      ({ error }) => useEnvironmentOperationToasts(error, clearOperationError, showToast),
      { initialProps: { error: "" } },
    );
    // Transition to error fires the toast
    rerender({ error: "fail" });
    expect(showToast).toHaveBeenCalledTimes(1);
    // Rerender with same error — should not fire again
    rerender({ error: "fail" });
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
