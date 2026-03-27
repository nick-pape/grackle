/**
 * Knowledge graph sidebar navigation — search, workspace filter, and node list.
 *
 * Rendered inside the shared Sidebar component when the Knowledge tab is active.
 *
 * @module
 */

import { useState, useCallback, type FormEvent, type JSX } from "react";
import type { Workspace } from "../../hooks/types.js";
import type { GraphNode } from "../../hooks/types.js";
import styles from "./KnowledgeNav.module.scss";

/** Props for the KnowledgeNav sidebar component. */
export interface KnowledgeNavProps {
  /** Nodes currently in the graph. */
  nodes: GraphNode[];
  /** All workspaces for the filter dropdown. */
  workspaces: Workspace[];
  /** Whether a search or load operation is in progress. */
  loading: boolean;
  /** Active search query (non-empty means search is active). */
  searchQuery: string;
  /** Execute a semantic search. */
  onSearch: (query: string) => void;
  /** Clear search and reload recent nodes. */
  onClearSearch: () => void;
  /** Select a node by ID (e.g., open detail panel). */
  onSelectNode: (nodeId: string) => void;
  /** Filter by workspace (empty string means all workspaces). */
  onWorkspaceChange: (workspaceId: string) => void;
}

/** Sidebar content for the Knowledge tab. */
export function KnowledgeNav({
  nodes,
  workspaces,
  loading,
  searchQuery,
  onSearch,
  onClearSearch,
  onSelectNode,
  onWorkspaceChange,
}: KnowledgeNavProps): JSX.Element {
  const [searchInput, setSearchInput] = useState("");

  const handleSearch = useCallback((e: FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      onSearch(searchInput.trim());
    }
  }, [searchInput, onSearch]);

  const handleClear = useCallback(() => {
    setSearchInput("");
    onClearSearch();
  }, [onClearSearch]);

  const handleNodeClick = useCallback((nodeId: string) => {
    onSelectNode(nodeId);
  }, [onSelectNode]);

  const handleWorkspaceChange = useCallback((wsId: string) => {
    setSearchInput("");
    onWorkspaceChange(wsId);
  }, [onWorkspaceChange]);

  return (
    <div className={styles.nav} data-testid="knowledge-nav">
      {/* Search */}
      <form className={styles.searchForm} onSubmit={handleSearch}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search..."
          value={searchInput}
          onChange={(e) => { setSearchInput(e.target.value); }}
          data-testid="knowledge-search-input"
        />
        <button type="submit" className={styles.searchButton} disabled={loading}>
          Go
        </button>
      </form>
      {searchQuery && (
        <button type="button" className={styles.clearButton} onClick={handleClear}>
          Clear search
        </button>
      )}

      {/* Workspace filter */}
      <select
        className={styles.workspaceSelect}
        onChange={(e) => { handleWorkspaceChange(e.target.value); }}
        data-testid="knowledge-workspace-filter"
      >
        <option value="">All workspaces</option>
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>{ws.name}</option>
        ))}
      </select>

      {/* Node list */}
      <div className={styles.listHeader}>
        Nodes ({nodes.length})
      </div>
      <ul className={styles.nodeList}>
        {nodes.map((node: GraphNode) => (
          <li
            key={node.id}
            className={styles.nodeItem}
            onClick={() => { handleNodeClick(node.id); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleNodeClick(node.id); } }}
            role="button"
            tabIndex={0}
          >
            <span
              className={styles.indicator}
              style={{
                backgroundColor:
                  node.kind === "reference" ? "#4A9EFF"
                  : node.category === "decision" ? "#22C55E"
                  : node.category === "concept" ? "#A855F7"
                  : node.category === "snippet" ? "#6B7280"
                  : "#EAB308",
              }}
            />
            <span className={styles.label}>{node.label}</span>
            <span className={styles.badge}>
              {node.kind === "reference" ? node.sourceType : node.category}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
