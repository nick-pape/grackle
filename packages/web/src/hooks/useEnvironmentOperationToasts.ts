/**
 * Bridge hook that surfaces environment operation errors as toasts.
 *
 * Watches the `operationError` state from {@link useEnvironments} and fires
 * an error toast whenever a new (non-empty) error appears. After toasting,
 * calls `clearOperationError` so the same error is not shown twice.
 *
 * @module
 */

import { useEffect, useRef } from "react";
import type { ToastVariant } from "@grackle-ai/web-components";

/**
 * Fires an error toast when a new environment operation error appears.
 *
 * @param operationError - The current error message from useEnvironments.
 * @param clearOperationError - Callback to clear the error after toasting.
 * @param showToast - Toast display function from the ToastContext.
 */
export function useEnvironmentOperationToasts(
  operationError: string,
  clearOperationError: () => void,
  showToast: (message: string, variant?: ToastVariant) => void,
): void {
  const prevRef = useRef(operationError);

  useEffect(() => {
    if (operationError && operationError !== prevRef.current) {
      showToast(operationError, "error");
      clearOperationError();
    }
    prevRef.current = operationError;
  }, [operationError, clearOperationError, showToast]);
}
