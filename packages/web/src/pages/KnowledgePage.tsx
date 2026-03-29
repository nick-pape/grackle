/**
 * Knowledge Graph explorer page.
 *
 * Shows a force-directed graph of knowledge nodes. Search, workspace filter,
 * and node list live in the shared Sidebar (via KnowledgeNav).
 *
 * @module
 */

import { useCallback, useEffect, type JSX } from "react";
import { Breadcrumbs, KNOWLEDGE_URL, KnowledgeDetailPanel, KnowledgeGraph } from "@grackle-ai/web-components";
import { useGrackle } from "../context/GrackleContext.js";
import styles from "./KnowledgePage.module.scss";

/** Knowledge Graph explorer page. */
export function KnowledgePage(): JSX.Element {
  const { knowledge } = useGrackle();

  // Load recent nodes on mount
  useEffect(() => {
    knowledge.loadRecent().catch(() => {});
  }, [knowledge]);

  const handleNodeClick = useCallback((nodeId: string) => {
    knowledge.selectNode(nodeId).catch(() => {});
  }, [knowledge]);

  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    knowledge.expandNode(nodeId).catch(() => {});
  }, [knowledge]);

  const handleCloseDetail = useCallback(() => {
    knowledge.clearSelection();
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
            selectedNodeId={knowledge.selectedId}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
          />
        )}

        {knowledge.selectedNode && knowledge.selectedId && (
          <KnowledgeDetailPanel
            detail={knowledge.selectedNode}
            nodes={knowledge.graphData.nodes}
            onClose={handleCloseDetail}
            onSelectNode={handleNodeClick}
          />
        )}
      </div>
    </div>
  );
}
