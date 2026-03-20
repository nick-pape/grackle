import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { HOME_URL, SETTINGS_URL, useAppNavigate } from "../../utils/navigation.js";
import styles from "./StatusBar.module.scss";

/** Props for the StatusBar component. */
interface StatusBarProps {
  /** Callback to toggle the mobile sidebar drawer. */
  onToggleSidebar?: () => void;
  /** Whether the sidebar drawer is currently open (for aria-expanded). */
  sidebarOpen?: boolean;
}

/** Top status bar showing connection state, environment counts, and active session count. */
export function StatusBar({ onToggleSidebar, sidebarOpen }: StatusBarProps): JSX.Element {
  const { connected, environments, sessions } = useGrackle();
  const navigate = useAppNavigate();
  const totalEnvs = environments.length;
  const connectedEnvs = environments.filter((e) => e.status === "connected").length;
  const activeCount = sessions.filter((s) => ["running", "idle"].includes(s.status)).length;

  return (
    <div className={styles.container}>
      {onToggleSidebar && (
        <button type="button" className={styles.hamburger} onClick={onToggleSidebar} aria-label="Toggle sidebar" aria-expanded={sidebarOpen}>
          {"\u2630"}
        </button>
      )}
      <button type="button" className={styles.brand} onClick={() => navigate(HOME_URL)} title="Home">Grackle</button>
      <div className={styles.info}>
        <span aria-label={connected ? "Connected" : "Disconnected"}>
          <span className={`${styles.connectionDot} ${connected ? styles.connected : styles.disconnected}`} aria-hidden="true">
            {"\u25CF"}
          </span>
          {" "}<span className={styles.connectionLabel} aria-hidden="true">{connected ? "Connected" : "Disconnected"}</span>
        </span>
        <span>{connectedEnvs}/{totalEnvs} env{totalEnvs !== 1 ? "s" : ""}</span>
        <span>{activeCount} active</span>
        <button
          className={styles.settingsButton}
          onClick={() => navigate(SETTINGS_URL)}
          title="Settings"
        >
          {"\u2699"}
        </button>
      </div>
    </div>
  );
}
