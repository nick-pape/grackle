import type { JSX } from "react";
import type { ConnectionStatus, Environment, Session } from "../../hooks/types.js";
import styles from "./SettingsPanel.module.scss";

declare const __APP_VERSION__: string;

/** Human-readable label for each connection state. */
const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connected: "Connected",
  connecting: "Connecting...",
  disconnected: "Disconnected",
};

/** CSS class for the connection dot in each state. */
const CONNECTION_DOT_CLASS: Record<ConnectionStatus, string> = {
  connected: styles.aboutDotConnected,
  connecting: styles.aboutDotConnecting,
  disconnected: styles.aboutDotDisconnected,
};

/** Props for the AboutPanel component. */
interface AboutPanelProps {
  /** Current connection state of the event stream. */
  connectionStatus: ConnectionStatus;
  /** List of all environments. */
  environments: Environment[];
  /** List of all sessions. */
  sessions: Session[];
}

/** About panel showing connection status, environment summary, session count, and version. */
export function AboutPanel({ connectionStatus, environments, sessions }: AboutPanelProps): JSX.Element {
  const connectedEnvs = environments.filter((e) => e.status === "connected").length;
  const totalEnvs = environments.length;
  const activeSessionCount = sessions.filter((s) => ["running", "idle"].includes(s.status)).length;

  return (
    <section className={styles.section} data-testid="about-panel">
      <h3 className={styles.sectionTitle}>About</h3>
      <p className={styles.sectionDescription}>
        Connection status and application information.
      </p>
      <div className={styles.aboutGrid}>
        <div className={styles.aboutItem}>
          <span className={styles.aboutLabel}>Connection</span>
          <span className={styles.aboutValue}>
            <span className={`${styles.aboutDot} ${CONNECTION_DOT_CLASS[connectionStatus]}`} />
            {CONNECTION_LABEL[connectionStatus]}
          </span>
        </div>
        <div className={styles.aboutItem}>
          <span className={styles.aboutLabel}>Environments</span>
          <span className={styles.aboutValue}>{connectedEnvs}/{totalEnvs} connected</span>
        </div>
        <div className={styles.aboutItem}>
          <span className={styles.aboutLabel}>Active Sessions</span>
          <span className={styles.aboutValue}>{activeSessionCount}</span>
        </div>
        <div className={styles.aboutItem}>
          <span className={styles.aboutLabel}>Version</span>
          <span className={styles.aboutValue}>{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown"}</span>
        </div>
      </div>
    </section>
  );
}
