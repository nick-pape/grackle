/**
 * StreamDetailPanel — right pull-out drawer showing stream metadata.
 *
 * Renders as an absolutely-positioned overlay anchored to the right of its
 * containing block (which must have `position: relative`).
 *
 * @module
 */

import { useEffect, type JSX } from "react";
import type { StreamData } from "../../hooks/types.js";
import { useAppNavigate, sessionUrl } from "../../utils/navigation.js";
import styles from "./StreamDetailPanel.module.scss";

/** Props for the StreamDetailPanel component. */
export interface StreamDetailPanelProps {
  /** The stream to display details for. */
  stream: StreamData;
  /** Called when the user requests to close the panel. */
  onClose: () => void;
}

/** Render a permission badge with appropriate color. */
function PermissionBadge({ permission }: { permission: string }): JSX.Element {
  const cls = permission === "rw"
    ? styles.badgeRw
    : permission === "r"
      ? styles.badgeR
      : styles.badgeW;
  return <span className={cls}>{permission}</span>;
}

/** Render a delivery mode badge with appropriate color. */
function DeliveryModeBadge({ mode }: { mode: string }): JSX.Element {
  const cls = mode === "async"
    ? styles.badgeAsync
    : mode === "detach"
      ? styles.badgeDetach
      : styles.badgeSync;
  return <span className={cls}>{mode}</span>;
}

/**
 * Pull-out right drawer showing stream metadata: overview, subscribers, fds.
 */
export function StreamDetailPanel({ stream, onClose }: StreamDetailPanelProps): JSX.Element {
  const navigate = useAppNavigate();

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); };
  }, [onClose]);

  return (
    <div className={styles.panel} data-testid="stream-detail-panel">
      <div className={styles.header}>
        <h3 className={styles.title}>{stream.name}</h3>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close stream details">
          &times;
        </button>
      </div>

      <div className={styles.body}>
        {/* Overview */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Overview</div>
          <div className={styles.metaRow}>
            <span className={styles.metaKey}>Stream ID</span>
            <span className={styles.metaValue}>{stream.id}</span>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.metaKey}>Subscribers</span>
            <span className={styles.metaValue}>{stream.subscriberCount}</span>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.metaKey}>Buffered</span>
            <span className={styles.metaValue}>{stream.messageBufferDepth} msgs</span>
          </div>
        </div>

        {/* Subscribers */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Subscribers</div>
          {stream.subscribers.length === 0 ? (
            <div className={styles.emptySubscribers}>No active subscribers</div>
          ) : (
            stream.subscribers.map((sub) => (
              <div key={sub.subscriptionId} className={styles.subscriberCard} data-testid={`subscriber-card-${sub.subscriptionId}`}>
                <div className={styles.subscriberHeader}>
                  <span className={styles.fdNumber}>fd {sub.fd}</span>
                  <button
                    className={styles.sessionLink}
                    onClick={() => { navigate(sessionUrl(sub.sessionId)); }}
                    title={sub.sessionId}
                  >
                    {sub.sessionId.slice(0, 12)}…
                  </button>
                </div>
                <div className={styles.badges}>
                  <PermissionBadge permission={sub.permission} />
                  <DeliveryModeBadge mode={sub.deliveryMode} />
                  {sub.createdBySpawn && (
                    <span className={styles.spawnTag}>spawn</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
