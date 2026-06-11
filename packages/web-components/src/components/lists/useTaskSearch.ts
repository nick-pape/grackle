import { useMemo, useState } from "react";
import type { TaskData } from "../../hooks/types.js";
import { fuzzySearch, type FuzzyKey, type MatchIndex } from "@grackle-ai/common";

/** Fuzzy search keys for task matching (title weighted 2x over description). */
const TASK_SEARCH_KEYS: FuzzyKey[] = [
  { name: "title", weight: 2 },
  { name: "description", weight: 1 },
];

/** Return type of the useTaskSearch hook. */
export interface UseTaskSearchResult {
  /** Current search query string. */
  searchQuery: string;
  /** Update the search query. */
  setSearchQuery: (query: string) => void;
  /** Task IDs that directly matched the query, or undefined when not searching. */
  directMatchTaskIds: Set<string> | undefined;
  /** Task IDs that matched or are ancestors of a match, or undefined when not searching. */
  treeMatchTaskIds: Set<string> | undefined;
  /** Per-task title highlight indices for matched queries. */
  titleHighlights: Map<string, readonly MatchIndex[]>;
  /** True when a non-empty query is active. */
  isSearching: boolean;
}

/**
 * Manages fuzzy search state for a task list. Returns match sets and title
 * highlight indices; callers decide which set to use based on their layout mode.
 *
 * @param tasks - The full list of tasks to search over.
 */
export function useTaskSearch(tasks: TaskData[]): UseTaskSearchResult {
  const [searchQuery, setSearchQuery] = useState("");

  const { directMatchTaskIds, treeMatchTaskIds, titleHighlights } = useMemo(() => {
    if (!searchQuery.trim()) {
      return {
        directMatchTaskIds: undefined,
        treeMatchTaskIds: undefined,
        titleHighlights: new Map<string, readonly MatchIndex[]>(),
      };
    }
    const taskResults = fuzzySearch(tasks, searchQuery, TASK_SEARCH_KEYS);
    const directIds = new Set(taskResults.map((r) => r.item.id));

    const highlights = new Map<string, readonly MatchIndex[]>();
    for (const r of taskResults) {
      const titleMatch = r.matches.find((m) => m.key === "title");
      if (titleMatch) {
        highlights.set(r.item.id, titleMatch.indices);
      }
    }

    // Include ancestor tasks so the tree structure is preserved
    const treeIds = new Set(directIds);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    for (const taskId of [...directIds]) {
      let current = taskById.get(taskId);
      while (current?.parentTaskId) {
        treeIds.add(current.parentTaskId);
        current = taskById.get(current.parentTaskId);
      }
    }

    return {
      directMatchTaskIds: directIds,
      treeMatchTaskIds: treeIds,
      titleHighlights: highlights,
    };
  }, [searchQuery, tasks]);

  const isSearching = directMatchTaskIds !== undefined;

  return {
    searchQuery,
    setSearchQuery,
    directMatchTaskIds,
    treeMatchTaskIds,
    titleHighlights,
    isSearching,
  };
}
