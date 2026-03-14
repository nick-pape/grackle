import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { useThemeContext } from "../../context/ThemeContext.js";
import type { ViewMode } from "../../App.js";
import styles from "./StatusBar.module.scss";

/** Props for the StatusBar component. */
interface StatusBarProps {
  setViewMode?: (mode: ViewMode) => void;
}

/** Top status bar showing connection state, environment counts, and active session count. */
/** Theme label mapping for the cycle button. */
const THEME_LABELS: Record<string, string> = {
  system: "\u2699",
  light: "\u2600",
  dark: "\u263E",
};

/** Cycle order for theme toggle. */
const THEME_CYCLE: Array<"system" | "light" | "dark"> = ["system", "light", "dark"];

export function StatusBar({ setViewMode }: StatusBarProps): JSX.Element {
  const { connected, environments, sessions } = useGrackle();
  const { theme, setTheme } = useThemeContext();
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
          className={styles.themeButton}
          onClick={() => {
            const idx = THEME_CYCLE.indexOf(theme);
            setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
          }}
          title={`Theme: ${theme}`}
        >
          {THEME_LABELS[theme]}
        </button>
        {setViewMode && (
          <>
            <button
              className={styles.settingsButton}
              onClick={() => setViewMode({ kind: "persona_management" })}
              title="Personas"
            >
              {"\uD83D\uDC64"}
            </button>
            <button
              className={styles.settingsButton}
              onClick={() => setViewMode({ kind: "settings" })}
              title="Settings"
            >
              {"\u2699"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
