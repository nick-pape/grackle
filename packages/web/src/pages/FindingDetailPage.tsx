/**
 * Finding detail page — displays a single finding with full content.
 *
 * @module
 */

import { useEffect, type JSX } from "react";
import { useParams } from "react-router";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useGrackle } from "../context/GrackleContext.js";
import {
  Breadcrumbs,
  buildFindingBreadcrumbs,
  taskUrl, sessionUrl, useAppNavigate,
  formatRelativeTime,
} from "@grackle-ai/web-components";
import styles from "./FindingDetailPage.module.scss";

/** Category color mapping matching FindingsPanel. */
const CATEGORY_COLORS: Record<string, { text: string; bg: string }> = {
  architecture: { text: "var(--accent-blue)", bg: "var(--accent-blue-dim)" },
  api: { text: "var(--accent-green)", bg: "var(--accent-green-dim)" },
  bug: { text: "var(--accent-red)", bg: "var(--accent-red-dim)" },
  decision: { text: "var(--accent-yellow)", bg: "var(--accent-yellow-dim)" },
  dependency: { text: "var(--accent-purple)", bg: "var(--accent-purple-dim)" },
  pattern: { text: "var(--accent-cyan)", bg: "var(--accent-cyan-dim)" },
  general: { text: "var(--text-secondary)", bg: "var(--bg-elevated)" },
};

/** Finding detail page. */
export function FindingDetailPage(): JSX.Element {
  const { findingId, environmentId, workspaceId } = useParams<{
    findingId: string;
    environmentId?: string;
    workspaceId?: string;
  }>();
  const { selectedFinding, loadFinding, workspaces, environments } = useGrackle();
  const navigate = useAppNavigate();

  useEffect(() => {
    if (findingId) {
      loadFinding(findingId);
    }
  }, [findingId, loadFinding]);

  if (!selectedFinding) {
    return (
      <div className={styles.container} data-testid="finding-detail-page">
        <div className={styles.notFound}>
          Finding not found.
        </div>
      </div>
    );
  }

  const breadcrumbs = buildFindingBreadcrumbs(
    selectedFinding.title,
    workspaceId,
    environmentId,
    workspaces,
    environments,
  );

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- category may not be in the map
  const categoryColor = CATEGORY_COLORS[selectedFinding.category] || CATEGORY_COLORS.general;

  return (
    <div className={styles.container} data-testid="finding-detail-page">
      <Breadcrumbs segments={breadcrumbs} />

      <div className={styles.header}>
        <span
          className={styles.categoryBadge}
          style={{ background: categoryColor.bg, color: categoryColor.text }}
        >
          {selectedFinding.category}
        </span>
        <h1 className={styles.title}>{selectedFinding.title}</h1>
      </div>

      {selectedFinding.content && (
        <div className={styles.content}>
          <Markdown remarkPlugins={[remarkGfm]}>{selectedFinding.content}</Markdown>
        </div>
      )}

      {selectedFinding.tags.length > 0 && (
        <div className={styles.tags}>
          {selectedFinding.tags.map((tag) => (
            <span key={tag} className={styles.tag}>{tag}</span>
          ))}
        </div>
      )}

      <div className={styles.meta}>
        <span className={styles.metaTimestamp} title={selectedFinding.createdAt}>
          {formatRelativeTime(selectedFinding.createdAt)}
        </span>
        {selectedFinding.taskId && (
          <button
            type="button"
            className={styles.metaLink}
            onClick={() => { navigate(taskUrl(selectedFinding.taskId)); }}
          >
            View Task
          </button>
        )}
        {selectedFinding.sessionId && (
          <button
            type="button"
            className={styles.metaLink}
            onClick={() => { navigate(sessionUrl(selectedFinding.sessionId)); }}
          >
            View Session
          </button>
        )}
      </div>
    </div>
  );
}
