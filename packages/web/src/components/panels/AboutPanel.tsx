import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import styles from "./SettingsPanel.module.scss";

declare const __APP_VERSION__: string;

/** About panel showing connection status, environment summary, session count, and version. */
export function AboutPanel(): JSX.Element {
  const { connected, environments, sessions } = useGrackle();
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
            <span className={`${styles.aboutDot} ${connected ? styles.aboutDotConnected : styles.aboutDotDisconnected}`} />
            {connected ? "Connected" : "Disconnected"}
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
