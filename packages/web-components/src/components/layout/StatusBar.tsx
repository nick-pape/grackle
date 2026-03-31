import type { JSX } from "react";
import { Circle, Menu } from "lucide-react";
import type { ConnectionStatus, Environment, Session } from "../../hooks/types.js";
import { ICON_LG, ICON_XS } from "../../utils/iconSize.js";
import { HOME_URL, useAppNavigate } from "../../utils/navigation.js";
import { Tooltip } from "../display/Tooltip.js";
import styles from "./StatusBar.module.scss";

/** Human-readable label for each connection state. */
const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connected: "Connected",
  connecting: "Connecting...",
  disconnected: "Disconnected",
};

/** CSS class for the connection dot in each state. */
const CONNECTION_DOT_CLASS: Record<ConnectionStatus, string> = {
  connected: styles.connected,
  connecting: styles.connecting,
  disconnected: styles.disconnected,
};

/** Props for the StatusBar component. */
interface StatusBarProps {
  /** Current connection state of the event stream. */
  connectionStatus: ConnectionStatus;
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
export function StatusBar({ connectionStatus, environments, sessions, onToggleSidebar, sidebarOpen }: StatusBarProps): JSX.Element {
  const navigate = useAppNavigate();
  const totalEnvs = environments.length;
  const connectedEnvs = environments.filter((e) => e.status === "connected").length;
  const activeCount = sessions.filter((s) => ["running", "idle"].includes(s.status)).length;
  const label = CONNECTION_LABEL[connectionStatus];

  return (
    <div className={styles.container}>
      {onToggleSidebar && (
        <button type="button" className={styles.hamburger} onClick={onToggleSidebar} aria-label="Toggle sidebar" aria-expanded={sidebarOpen}>
          <Menu size={ICON_LG} aria-hidden="true" />
        </button>
      )}
      <Tooltip text="Home" placement="bottom">
        <button type="button" className={styles.brand} onClick={() => navigate(HOME_URL)} data-testid="statusbar-brand">
          <img src="/icon-192x192.png" alt="" className={styles.brandLogo} aria-hidden="true" data-testid="statusbar-logo" />
          Grackle
        </button>
      </Tooltip>
      <div className={styles.info}>
        <span aria-label={label}>
          <span className={`${styles.connectionDot} ${CONNECTION_DOT_CLASS[connectionStatus]}`} aria-hidden="true">
            <Circle size={ICON_XS} fill="currentColor" />
          </span>
          {" "}<span className={styles.connectionLabel} aria-hidden="true">{label}</span>
        </span>
        <span>{connectedEnvs}/{totalEnvs} env{totalEnvs !== 1 ? "s" : ""}</span>
        <span>{activeCount} active</span>
      </div>
    </div>
  );
}
