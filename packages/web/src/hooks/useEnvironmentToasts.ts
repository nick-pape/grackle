import { useEffect, useRef } from "react";
import type { Environment } from "./useGrackleSocket.js";
import type { ToastVariant } from "../context/ToastContext.js";

/**
 * Diffs the previous and current environment lists and fires toast
 * notifications for meaningful status transitions.
 *
 * Skips toasts on initial load (when the previous ref is null) and
 * for `connecting` transitions (the provision progress UI handles those).
 */
export function useEnvironmentToasts(
  environments: Environment[],
  showToast: (message: string, variant?: ToastVariant, duration?: number) => void,
): void {
  const prevRef = useRef<Environment[] | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = environments;

    // Skip toasts on initial load
    if (prev === null) {
      return;
    }

    const prevMap = new Map<string, Environment>();
    for (const env of prev) {
      prevMap.set(env.id, env);
    }

    const currentIds = new Set<string>();

    for (const env of environments) {
      currentIds.add(env.id);
      const old = prevMap.get(env.id);

      // New environment added — skip (add operation has its own UX)
      if (!old) {
        continue;
      }

      // No status change
      if (old.status === env.status) {
        continue;
      }

      // Skip connecting transitions — provision progress UI handles these
      if (env.status === "connecting") {
        continue;
      }

      if (env.status === "connected") {
        showToast("Environment connected", "success");
      } else if (env.status === "error") {
        showToast("Environment provision failed", "error");
      } else if (env.status === "disconnected") {
        if (old.status === "connected") {
          showToast("Environment disconnected", "warning");
        } else {
          showToast("Environment stopped", "info");
        }
      }
    }

    // Check for removed environments
    for (const old of prev) {
      if (!currentIds.has(old.id)) {
        showToast("Environment removed", "info");
      }
    }
  }, [environments, showToast]);
}
