/**
 * Slide-in detail panel for a selected knowledge graph node.
 *
 * @module
 */

import type { JSX } from "react";
import type { NodeDetail } from "../../hooks/useKnowledge.js";
import { taskUrl, sessionUrl } from "../../utils/navigation.js";
import { useAppNavigate } from "../../utils/navigation.js";
import styles from "./KnowledgeDetailPanel.module.scss";

interface KnowledgeDetailPanelProps {
  detail: NodeDetail;
  onClose: () => void;
  onSelectNode: (id: string) => void;
}

/** Slide-in panel showing full details for a selected knowledge node. */
export function KnowledgeDetailPanel({
  detail,
  onClose,
  onSelectNode,
}: KnowledgeDetailPanelProps): JSX.Element {
  const navigate = useAppNavigate();
  const { node, edges } = detail;

  /** Navigate to the source entity for reference nodes. */
  function handleViewInGrackle(): void {
    if (node.kind !== "reference" || !node.sourceId) {
      return;
    }
    switch (node.sourceType) {
      case "task":
        navigate(taskUrl(node.sourceId));
        break;
      case "session":
        navigate(sessionUrl(node.sourceId));
        break;
      default:
        break;
    }
  }

  return (
    <div className={styles.panel} data-testid="knowledge-detail-panel">
      <div className={styles.header}>
        <h3 className={styles.title}>{node.label}</h3>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close">
          &times;
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.badge}>
          {node.kind === "reference" ? `Reference (${node.sourceType})` : node.category}
        </div>

        {node.content && (
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Content</div>
            <p className={styles.content}>{node.content}</p>
          </div>
        )}

        {node.tags && node.tags.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Tags</div>
            <div className={styles.tags}>
              {node.tags.map((tag) => (
                <span key={tag} className={styles.tag}>{tag}</span>
              ))}
            </div>
          </div>
        )}

        {node.kind === "reference" && node.sourceId && (
          <div className={styles.section}>
            <button className={styles.viewLink} onClick={handleViewInGrackle}>
              View in Grackle &rarr;
            </button>
          </div>
        )}

        {edges.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Edges ({edges.length})</div>
            <ul className={styles.edgeList}>
              {edges.map((edge, i) => {
                const otherId = edge.fromId === node.id ? edge.toId : edge.fromId;
                return (
                  <li key={i} className={styles.edgeItem}>
                    <span className={styles.edgeType}>{edge.type}</span>
                    <button
                      className={styles.edgeNodeLink}
                      onClick={() => { onSelectNode(otherId); }}
                    >
                      {otherId.substring(0, 8)}...
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className={styles.timestamps}>
          {node.createdAt && <div>Created: {new Date(node.createdAt).toLocaleDateString()}</div>}
          {node.updatedAt && <div>Updated: {new Date(node.updatedAt).toLocaleDateString()}</div>}
        </div>
      </div>
    </div>
  );
}
