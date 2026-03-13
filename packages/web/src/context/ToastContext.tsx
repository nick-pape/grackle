import React, { createContext, useContext, useState, useCallback, type ReactNode, type JSX } from "react";

/** Visual style variant for a toast notification. */
export type ToastVariant = "success" | "error" | "warning" | "info";

/** A single toast notification item. */
export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  /** Auto-dismiss delay in milliseconds. */
  duration: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  /** Display a new toast notification. */
  showToast: (message: string, variant?: ToastVariant, duration?: number) => void;
  /** Programmatically remove a toast by id. */
  dismissToast: (id: string) => void;
}

const ToastContext: React.Context<ToastContextValue | undefined> = createContext<ToastContextValue | undefined>(undefined);

const DEFAULT_DURATION_MS: number = 4_000;
let toastCounter: number = 0;

/** Provides toast notification state to the component tree. Mount <ToastContainer> as a sibling to receive rendered output. */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "info", duration: number = DEFAULT_DURATION_MS) => {
      const id = `toast-${++toastCounter}`;
      setToasts((prev) => [...prev, { id, message, variant, duration }]);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

/** Consumes the toast context; must be called within a ToastProvider. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
