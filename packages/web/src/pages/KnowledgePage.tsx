/**
 * Knowledge Graph explorer page.
 *
 * Shows a force-directed graph of knowledge nodes with search,
 * click-to-select, and double-click-to-expand interactions.
 *
 * @module
 */

import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";
import { Breadcrumbs } from "../components/display/index.js";
import { KnowledgeGraph, KnowledgeDetailPanel } from "../components/knowledge/index.js";
import { useGrackle } from "../context/GrackleContext.js";
import { KNOWLEDGE_URL } from "../utils/navigation.js";
import type { GraphNode } from "../hooks/useKnowledge.js";
import styles from "./KnowledgePage.module.scss";

/** Knowledge Graph explorer page. */
export function KnowledgePage(): JSX.Element {
  const { knowledge, workspaces } = useGrackle();
  const [searchInput, setSearchInput] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("");

  // Load recent nodes on mount and when workspace filter changes
  const loadRecentFn = useCallback(
    (wsId?: string) => { knowledge.loadRecent(wsId); },
    // eslint-disable-next-line @typescript-eslint/unbound-method -- stable useCallback ref
    [knowledge.loadRecent],
  );
  useEffect(() => {
    loadRecentFn(workspaceFilter || undefined);
  }, [loadRecentFn, workspaceFilter]);

  const handleSearch = useCallback((e: FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setSelectedId(undefined);
      knowledge.search(searchInput.trim());
    }
  }, [searchInput, knowledge]);

  const handleClear = useCallback(() => {
    setSearchInput("");
    knowledge.clearSearch();
    setSelectedId(undefined);
  }, [knowledge]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedId(nodeId);
    knowledge.selectNode(nodeId);
  }, [knowledge]);

  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    knowledge.expandNode(nodeId);
  }, [knowledge]);

  const handleCloseDetail = useCallback(() => {
    setSelectedId(undefined);
  }, []);

  const handleSelectFromPanel = useCallback((nodeId: string) => {
    setSelectedId(nodeId);
    knowledge.selectNode(nodeId);
  }, [knowledge]);

  const breadcrumbs = [{ label: "Knowledge", url: KNOWLEDGE_URL }];

  return (
    <div className={styles.layout} data-testid="knowledge-page">
      <Breadcrumbs segments={breadcrumbs} />

      <form className={styles.toolbar} onSubmit={handleSearch}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search knowledge graph..."
          value={searchInput}
          onChange={(e) => { setSearchInput(e.target.value); }}
          data-testid="knowledge-search-input"
        />
        <button type="submit" className={styles.searchButton} disabled={knowledge.loading}>
          Search
        </button>
        {knowledge.searchQuery && (
          <button type="button" className={styles.clearButton} onClick={handleClear}>
            Clear
          </button>
        )}

        <select
          className={styles.workspaceSelect}
          value={workspaceFilter}
          onChange={(e) => { setWorkspaceFilter(e.target.value); }}
          data-testid="knowledge-workspace-filter"
        >
          <option value="">All workspaces</option>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>{ws.name}</option>
          ))}
        </select>
      </form>

      <div className={styles.mainArea}>
        {/* Left sidebar — node list */}
        <div className={styles.nodeList} data-testid="knowledge-node-list">
          <div className={styles.nodeListHeader}>
            Nodes ({knowledge.graphData.nodes.length})
          </div>
          <ul className={styles.nodeListItems}>
            {knowledge.graphData.nodes.map((node: GraphNode) => (
              <li
                key={node.id}
                className={`${styles.nodeListItem}${node.id === selectedId ? ` ${styles.nodeListItemSelected}` : ""}`}
                onClick={() => { handleNodeClick(node.id); }}
                role="button"
                tabIndex={0}
              >
                <span
                  className={styles.nodeListIndicator}
                  style={{ backgroundColor: node.kind === "reference" ? "#4A9EFF" : node.category === "decision" ? "#22C55E" : node.category === "concept" ? "#A855F7" : node.category === "snippet" ? "#6B7280" : "#EAB308" }}
                />
                <span className={styles.nodeListLabel}>{node.label}</span>
                <span className={styles.nodeListBadge}>
                  {node.kind === "reference" ? node.sourceType : node.category}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Graph area */}
        <div className={styles.graphArea}>
          {knowledge.graphData.nodes.length === 0 && !knowledge.loading ? (
            <div className={styles.empty}>
              <p>No knowledge nodes found.</p>
              <p>Knowledge nodes are created by agents during task execution, or manually via MCP tools.</p>
            </div>
          ) : (
            <KnowledgeGraph
              graphData={knowledge.graphData}
              selectedNodeId={selectedId}
              onNodeClick={handleNodeClick}
              onNodeDoubleClick={handleNodeDoubleClick}
            />
          )}

          {knowledge.selectedNode && selectedId && (
            <KnowledgeDetailPanel
              detail={knowledge.selectedNode}
              onClose={handleCloseDetail}
              onSelectNode={handleSelectFromPanel}
            />
          )}
        </div>
      </div>
    </div>
  );
}
