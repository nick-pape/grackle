import { useEffect, useRef } from "react";
import type { Environment } from "./useGrackleSocket.js";
import type { ToastVariant } from "@grackle-ai/web-components";

/**
 * Diffs the previous and current environment lists and fires toast
 * notifications for meaningful status transitions.
 *
 * Skips toasts on initial load (when the previous ref is null),
 * for `sleeping` transitions (passive state), and for `connecting`
 * transitions (auto-reconnect cycles through this on every retry attempt —
 * streaming provision progress provides richer feedback for user-initiated
 * reconnects).
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

      // Skip sleeping (passive state) and connecting (auto-reconnect cycles
      // through this on every retry; streaming provision progress handles
      // user-initiated reconnect feedback).
      if (env.status === "sleeping" || env.status === "connecting") {
        continue;
      }

      if (env.status === "connected") {
        showToast("Environment connected", "success");
      } else if (env.status === "error") {
        showToast("Environment provision failed", "error");
      } else if (env.status === "disconnected") {
        if (old.status === "connected") {
          // Genuine disconnect — was working, now gone.
          showToast("Environment disconnected", "warning");
        }
        // connecting → disconnected is a failed auto-reconnect attempt; the
        // user was already notified on the original connected → disconnected
        // transition, so stay silent here.
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
