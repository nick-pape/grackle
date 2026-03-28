import type { JSX } from "react";
import { Circle, Menu } from "lucide-react";
import type { Environment, Session } from "../../hooks/types.js";
import { ICON_LG } from "../../utils/iconSize.js";
import { HOME_URL, useAppNavigate } from "../../utils/navigation.js";
import styles from "./StatusBar.module.scss";

/** Props for the StatusBar component. */
interface StatusBarProps {
  /** Whether the WebSocket connection to the server is active. */
  connected: boolean;
  /** List of all environments. */
  environments: Environment[];
  /** List of all sessions. */
  sessions: Session[];
  /** Callback to toggle the mobile sidebar drawer. */
  onToggleSidebar?: () => void;
  /** Whether the sidebar drawer is currently open (for aria-expanded). */
  sidebarOpen?: boolean;
}

/** Top status bar showing connection state, environment counts, and active session count. */
export function StatusBar({ connected, environments, sessions, onToggleSidebar, sidebarOpen }: StatusBarProps): JSX.Element {
  const navigate = useAppNavigate();
  const totalEnvs = environments.length;
  const connectedEnvs = environments.filter((e) => e.status === "connected").length;
  const activeCount = sessions.filter((s) => ["running", "idle"].includes(s.status)).length;

  return (
    <div className={styles.container}>
      {onToggleSidebar && (
        <button type="button" className={styles.hamburger} onClick={onToggleSidebar} aria-label="Toggle sidebar" aria-expanded={sidebarOpen}>
          <Menu size={ICON_LG} />
        </button>
      )}
      <button type="button" className={styles.brand} onClick={() => navigate(HOME_URL)} title="Home">
        <img src="/icon-192x192.png" alt="" className={styles.brandLogo} aria-hidden="true" data-testid="statusbar-logo" />
        Grackle
      </button>
      <div className={styles.info}>
        <span aria-label={connected ? "Connected" : "Disconnected"}>
          <span className={`${styles.connectionDot} ${connected ? styles.connected : styles.disconnected}`} aria-hidden="true">
            <Circle size={8} fill="currentColor" />
          </span>
          {" "}<span className={styles.connectionLabel} aria-hidden="true">{connected ? "Connected" : "Disconnected"}</span>
        </span>
        <span>{connectedEnvs}/{totalEnvs} env{totalEnvs !== 1 ? "s" : ""}</span>
        <span>{activeCount} active</span>
      </div>
    </div>
  );
}
