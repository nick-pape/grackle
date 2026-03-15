import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { SETTINGS_URL, PERSONAS_URL, useAppNavigate } from "../../utils/navigation.js";
import styles from "./StatusBar.module.scss";

/** Top status bar showing connection state, environment counts, and active session count. */
export function StatusBar(): JSX.Element {
  const { connected, environments, sessions } = useGrackle();
  const navigate = useAppNavigate();
  const totalEnvs = environments.length;
  const connectedEnvs = environments.filter((e) => e.status === "connected").length;
  const activeCount = sessions.filter((s) => ["running", "waiting_input"].includes(s.status)).length;

  return (
    <div className={styles.container}>
      <div className={styles.brand}>Grackle</div>
      <div className={styles.info}>
        <span>
          <span className={`${styles.connectionDot} ${connected ? styles.connected : styles.disconnected}`}>
            {"\u25CF"}
          </span>
          {" "}{connected ? "Connected" : "Disconnected"}
        </span>
        <span>{connectedEnvs}/{totalEnvs} env{totalEnvs !== 1 ? "s" : ""}</span>
        <span>{activeCount} active</span>
        <button
          className={styles.settingsButton}
          onClick={() => navigate(PERSONAS_URL)}
          title="Personas"
        >
          {"\uD83D\uDC64"}
        </button>
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
