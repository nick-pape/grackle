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
import styles from "./KnowledgePage.module.scss";

/** Knowledge Graph explorer page. */
export function KnowledgePage(): JSX.Element {
  const { knowledge } = useGrackle();
  const [searchInput, setSearchInput] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  // Load recent nodes on mount
  useEffect(() => {
    knowledge.loadRecent();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- loadRecent is a stable useCallback
  }, [knowledge.loadRecent]);

  const handleSearch = useCallback((e: FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
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
        {knowledge.loading && knowledge.graphData.nodes.length === 0 && (
          <span className={styles.spinner}>Loading...</span>
        )}
      </form>

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
  );
}
