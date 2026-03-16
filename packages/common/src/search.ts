/**
 * Shared fuzzy search utility wrapping fuse.js.
 * Used by both the web UI (client-side sidebar filter) and the server (fuzzy task search).
 */
import Fuse from "fuse.js";

/** Index range describing a matched substring [start, end] (inclusive). */
export type MatchIndex = readonly [number, number];

/** Details about which field matched and where. */
export interface FuzzyMatch {
  /** The field key that matched (e.g. "title"). */
  key: string;
  /** Ranges within the field value that matched the query. */
  indices: readonly MatchIndex[];
}

/** A single fuzzy search result with its matched item and relevance score. */
export interface FuzzyResult<T> {
  /** The matched item from the input collection. */
  item: T;
  /** Relevance score where 0 is a perfect match and 1 is no match. */
  score: number;
  /** Which fields matched and where, useful for highlighting. */
  matches: FuzzyMatch[];
}

/** Configuration for a searchable field with a relative weight. */
export interface FuzzyKey {
  /** Property path on the item (e.g. "title", "description"). */
  name: string;
  /** Relative weight for this field. Higher = more important. */
  weight: number;
}

/** Options for tuning fuzzy search behavior. */
export interface FuzzySearchOptions {
  /** Maximum score threshold (0–1). Results above this are excluded. Default: 0.3. */
  threshold?: number;
  /** Maximum number of results to return. Default: no limit. */
  limit?: number;
}

/**
 * Perform a fuzzy search over a collection of items.
 *
 * @param items - The items to search through.
 * @param query - The search query string. Empty string returns an empty array.
 * @param keys - Which fields to search, with relative weights.
 * @param options - Optional threshold and limit overrides.
 * @returns Matched items sorted by relevance (best first), capped at `limit`.
 */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  keys: FuzzyKey[],
  options?: FuzzySearchOptions,
): FuzzyResult<T>[] {
  if (!query.trim()) {
    return [];
  }

  const threshold = options?.threshold ?? 0.3;
  const fuse = new Fuse(items, {
    keys,
    threshold,
    ignoreLocation: true,
    includeScore: true,
    includeMatches: true,
    minMatchCharLength: 2,
  });

  const results = fuse.search(query);

  const mapped = results.map((r) => ({
    item: r.item,
    score: r.score ?? 1,
    matches: (r.matches ?? []).map((m) => ({
      key: m.key ?? "",
      indices: m.indices as readonly MatchIndex[],
    })),
  }));

  if (options?.limit !== undefined) {
    return mapped.slice(0, options.limit);
  }
  return mapped;
}
