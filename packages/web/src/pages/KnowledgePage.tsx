/**
 * Knowledge Graph explorer page.
 *
 * Shows a force-directed graph of knowledge nodes. Search, workspace filter,
 * and node list live in the shared Sidebar (via KnowledgeNav).
 *
 * @module
 */

import { useCallback, useEffect, type JSX } from "react";
import {
  HOME_URL,
  KNOWLEDGE_URL,
  KnowledgeDetailPanel,
  KnowledgeGraph,
  PageHeader,
} from "@grackle-ai/web-components";
import { useGrackle } from "../context/GrackleContext.js";
import styles from "./KnowledgePage.module.scss";

/** Knowledge Graph explorer page. */
export function KnowledgePage(): JSX.Element {
  const { knowledge } = useGrackle();
  const { loadRecent, loadError, loading, graphData, selectedId, selectedNode } = knowledge;
  const { selectNode, expandNode, clearSelection } = knowledge;

  // Load recent nodes once on mount.
  //
  // Depend on the stable `loadRecent` callback, NOT the whole `knowledge`
  // object (#1357). `knowledge` changes identity whenever any knowledge state
  // updates, so `[knowledge]` here re-ran the effect on every render — each run
  // fired `loadRecent`, whose `setLoading`/`setNodes` calls triggered the next
  // render, an infinite fetch loop. Against a down Neo4j it became a 503 storm
  // and froze tab navigation under the constant re-renders.
  useEffect(() => {
    loadRecent().catch(() => {});
  }, [loadRecent]);

  const handleRetry = useCallback(() => {
    loadRecent().catch(() => {});
  }, [loadRecent]);

  // Depend on the specific stable callback refs, not the whole `knowledge`
  // object — `knowledge` changes identity on any knowledge state change, which
  // would needlessly recreate these handlers and re-render the graph/detail.
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      selectNode(nodeId).catch(() => {});
    },
    [selectNode],
  );

  const handleNodeDoubleClick = useCallback(
    (nodeId: string) => {
      expandNode(nodeId).catch(() => {});
    },
    [expandNode],
  );

  const handleCloseDetail = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const breadcrumbs = [{ label: "Knowledge", url: KNOWLEDGE_URL }];

  const showError = loadError !== undefined && !loading;
  const showEmpty = !showError && graphData.nodes.length === 0 && !loading;

  return (
    <div className={styles.layout} data-testid="knowledge-page">
      <PageHeader segments={breadcrumbs} backUrl={HOME_URL} />

      <div className={styles.graphArea}>
        {showError ? (
          <div className={styles.empty} data-testid="knowledge-error">
            {loadError === "unavailable" ? (
              <>
                <p>Knowledge server can&apos;t be reached.</p>
                <p>
                  The knowledge graph database (Neo4j) isn&apos;t running or is unreachable. Start
                  it, then retry.
                </p>
              </>
            ) : (
              <>
                <p>Failed to load the knowledge graph.</p>
                <p>Something went wrong while loading knowledge nodes.</p>
              </>
            )}
            <button
              type="button"
              className={styles.retryButton}
              onClick={handleRetry}
              data-testid="knowledge-retry"
            >
              Retry
            </button>
          </div>
        ) : showEmpty ? (
          <div className={styles.empty}>
            <p>No knowledge nodes found.</p>
            <p>Create knowledge via MCP tools or let agents discover it during tasks.</p>
          </div>
        ) : (
          <KnowledgeGraph
            graphData={graphData}
            selectedNodeId={selectedId}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
          />
        )}

        {selectedNode && selectedId && (
          <KnowledgeDetailPanel
            detail={selectedNode}
            nodes={graphData.nodes}
            onClose={handleCloseDetail}
            onSelectNode={handleNodeClick}
          />
        )}
      </div>
    </div>
  );
}
