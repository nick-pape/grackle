/**
 * Hook to fetch the server's version status (current vs latest).
 *
 * Calls {@link grackleClient.getVersionStatus} once on mount and returns
 * the result, or `undefined` if still loading or on error.
 *
 * @module
 */

import { useEffect, useState } from "react";
import { grackleClient } from "./useGrackleClient.js";

/** Version status returned by the server. */
export interface VersionStatusInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  isDocker: boolean;
}

/**
 * Fetch the version status from the server on mount.
 *
 * @returns The version status, or `undefined` if not yet loaded or on error.
 */
export function useVersionStatus(): VersionStatusInfo | undefined {
  const [status, setStatus] = useState<VersionStatusInfo | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const result = await grackleClient.getVersionStatus({});
        if (!cancelled) {
          setStatus({
            currentVersion: result.currentVersion,
            latestVersion: result.latestVersion,
            updateAvailable: result.updateAvailable,
            isDocker: result.isDocker,
          });
        }
      } catch {
        // Silent failure — version check is non-critical
      }
    };
    load().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
