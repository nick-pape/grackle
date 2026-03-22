/**
 * Knowledge Graph explorer page.
 *
 * Shows a force-directed graph of knowledge nodes. Search, workspace filter,
 * and node list live in the shared Sidebar (via KnowledgeNav).
 *
 * @module
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { Breadcrumbs } from "../components/display/index.js";
import { KnowledgeGraph, KnowledgeDetailPanel } from "../components/knowledge/index.js";
import { useGrackle } from "../context/GrackleContext.js";
import { KNOWLEDGE_URL } from "../utils/navigation.js";
import styles from "./KnowledgePage.module.scss";

/** Knowledge Graph explorer page. */
export function KnowledgePage(): JSX.Element {
  const { knowledge } = useGrackle();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  // Load recent nodes on mount
  const loadRecentFn = useCallback(
    () => { knowledge.loadRecent(); },
    // eslint-disable-next-line @typescript-eslint/unbound-method -- stable useCallback ref
    [knowledge.loadRecent],
  );
  useEffect(() => {
    loadRecentFn();
  }, [loadRecentFn]);

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

      <div className={styles.graphArea}>
        {knowledge.graphData.nodes.length === 0 && !knowledge.loading ? (
          <div className={styles.empty}>
            <p>No knowledge nodes found.</p>
            <p>Create knowledge via MCP tools or let agents discover it during tasks.</p>
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
