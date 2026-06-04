/**
 * useFilterGroupSort -- shared localStorage-persisted filter, group, and sort state
 * for sidebar nav components.
 *
 * @module
 */

import { useCallback, useState } from "react";

/** Options for {@link useFilterGroupSort}. */
export interface UseFilterGroupSortOptions {
  /** localStorage key prefix (e.g., "grackle-env-nav"). Keys are suffixed with "-filter", "-group", "-sort". */
  storagePrefix: string;
}

/** Return type of {@link useFilterGroupSort}. */
export interface UseFilterGroupSortReturn {
  /** Currently selected filter keys (read-only to prevent accidental mutation). */
  filterValues: ReadonlySet<string>;
  /** Whether any filter is active. */
  filterActive: boolean;
  /** Toggle a filter key on/off. */
  toggleFilter: (key: string) => void;
  /** Clear all filter selections. */
  clearFilter: () => void;
  /** Current group-by key, or "" for ungrouped. */
  groupBy: string;
  /** Whether grouping is active. */
  groupActive: boolean;
  /** Toggle a group-by key (same key again clears it). */
  toggleGroup: (key: string) => void;
  /** Clear grouping. */
  clearGroup: () => void;
  /** Current sort key, or "" for default order. */
  sortBy: string;
  /** Whether sorting is active. */
  sortActive: boolean;
  /** Toggle a sort key (same key again clears it). */
  toggleSort: (key: string) => void;
  /** Clear sorting. */
  clearSort: () => void;
}

/** Read a Set from localStorage. */
function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      return new Set(JSON.parse(raw) as string[]);
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

/** Persist a Set to localStorage. */
function saveSet(key: string, values: Set<string>): void {
  try {
    if (values.size === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify([...values]));
    }
  } catch {
    /* ignore */
  }
}

/** Read a string from localStorage. */
function loadString(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/** Persist a string to localStorage. */
function saveString(key: string, value: string): void {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

/** Shared filter/group/sort state with localStorage persistence. */
export function useFilterGroupSort({
  storagePrefix,
}: UseFilterGroupSortOptions): UseFilterGroupSortReturn {
  const filterKey = `${storagePrefix}-filter`;
  const groupKey = `${storagePrefix}-group`;
  const sortKey = `${storagePrefix}-sort`;

  const [filterValues, setFilterValues] = useState(() => loadSet(filterKey));
  const [groupBy, setGroupBy] = useState(() => loadString(groupKey));
  const [sortBy, setSortBy] = useState(() => loadString(sortKey));

  const toggleFilter = useCallback(
    (key: string) => {
      setFilterValues((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        saveSet(filterKey, next);
        return next;
      });
    },
    [filterKey],
  );

  const clearFilter = useCallback(() => {
    setFilterValues(new Set());
    saveSet(filterKey, new Set());
  }, [filterKey]);

  const toggleGroup = useCallback(
    (key: string) => {
      setGroupBy((prev) => {
        const next = prev === key ? "" : key;
        saveString(groupKey, next);
        return next;
      });
    },
    [groupKey],
  );

  const clearGroup = useCallback(() => {
    setGroupBy("");
    saveString(groupKey, "");
  }, [groupKey]);

  const toggleSort = useCallback(
    (key: string) => {
      setSortBy((prev) => {
        const next = prev === key ? "" : key;
        saveString(sortKey, next);
        return next;
      });
    },
    [sortKey],
  );

  const clearSort = useCallback(() => {
    setSortBy("");
    saveString(sortKey, "");
  }, [sortKey]);

  return {
    filterValues,
    filterActive: filterValues.size > 0,
    toggleFilter,
    clearFilter,
    groupBy,
    groupActive: groupBy !== "",
    toggleGroup,
    clearGroup,
    sortBy,
    sortActive: sortBy !== "",
    toggleSort,
    clearSort,
  };
}
