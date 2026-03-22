/**
 * Knowledge graph sidebar navigation — search, workspace filter, and node list.
 *
 * Rendered inside the shared Sidebar component when the Knowledge tab is active.
 *
 * @module
 */

import { useState, useCallback, type FormEvent, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import type { GraphNode } from "../../hooks/useKnowledge.js";
import styles from "./KnowledgeNav.module.scss";

/** Sidebar content for the Knowledge tab. */
export function KnowledgeNav(): JSX.Element {
  const { knowledge, workspaces } = useGrackle();
  const [searchInput, setSearchInput] = useState("");

  const handleSearch = useCallback((e: FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      knowledge.search(searchInput.trim());
    }
  }, [searchInput, knowledge]);

  const handleClear = useCallback(() => {
    setSearchInput("");
    knowledge.clearSearch();
  }, [knowledge]);

  const handleNodeClick = useCallback((nodeId: string) => {
    knowledge.selectNode(nodeId);
  }, [knowledge]);

  const handleWorkspaceChange = useCallback((wsId: string) => {
    knowledge.loadRecent(wsId || undefined);
  }, [knowledge]);

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
        <button type="submit" className={styles.searchButton} disabled={knowledge.loading}>
          Go
        </button>
      </form>
      {knowledge.searchQuery && (
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
        Nodes ({knowledge.graphData.nodes.length})
      </div>
      <ul className={styles.nodeList}>
        {knowledge.graphData.nodes.map((node: GraphNode) => (
          <li
            key={node.id}
            className={styles.nodeItem}
            onClick={() => { handleNodeClick(node.id); }}
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
