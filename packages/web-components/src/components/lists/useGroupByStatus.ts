import { useState } from "react";

/** localStorage key for the group-by-status toggle (separate from WorkspaceList's
 *  "grackle-group-by-status" key — each view has its own grouping preference). */
const STORAGE_KEY_GROUP_BY_STATUS: string = "grackle-task-group-by-status";

/** Read the persisted group-by-status preference. */
function getGroupByStatus(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_GROUP_BY_STATUS) === "true";
  } catch {
    return false;
  }
}

/** Persist the group-by-status preference. */
function saveGroupByStatus(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_GROUP_BY_STATUS, String(value));
  } catch {
    /* localStorage unavailable */
  }
}

/** Return type of the useGroupByStatus hook. */
export interface UseGroupByStatusResult {
  /** Whether tasks are grouped by status (vs. flat tree). */
  groupByStatus: boolean;
  /** Toggle the group-by-status mode and persist the preference. */
  toggleGroupByStatus: () => void;
  /** Whether a given status group accordion is expanded. */
  isGroupExpanded: (status: string) => boolean;
  /** Toggle a single status group accordion's expanded state. */
  toggleStatusGroup: (status: string) => void;
}

/**
 * Manages the group-by-status toggle and per-group accordion expansion state
 * for the task list sidebar. The toggle preference is persisted to localStorage.
 */
export function useGroupByStatus(): UseGroupByStatusResult {
  const [groupByStatus, setGroupByStatusState] = useState(getGroupByStatus);
  const [groupExpandDefault, setGroupExpandDefault] = useState(getGroupByStatus);
  const [groupExpandOverrides, setGroupExpandOverrides] = useState<Map<string, boolean>>(new Map());

  const toggleGroupByStatus = (): void => {
    const next = !groupByStatus;
    saveGroupByStatus(next);
    setGroupByStatusState(next);
    if (next) {
      setGroupExpandDefault(true);
      setGroupExpandOverrides(new Map());
    }
  };

  const toggleStatusGroup = (status: string): void => {
    setGroupExpandOverrides((prev) => {
      const next = new Map(prev);
      const current = next.has(status) ? next.get(status)! : groupExpandDefault;
      next.set(status, !current);
      return next;
    });
  };

  const isGroupExpanded = (status: string): boolean => {
    return groupExpandOverrides.has(status)
      ? groupExpandOverrides.get(status)!
      : groupExpandDefault;
  };

  return { groupByStatus, toggleGroupByStatus, isGroupExpanded, toggleStatusGroup };
}
