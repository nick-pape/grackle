import type { JSX } from "react";
import type { PluginData } from "../../hooks/types.js";
import styles from "./SettingsPanel.module.scss";

/** Props for the PluginsPanel component. */
export interface PluginsPanelProps {
  /** List of all known plugins. */
  plugins: PluginData[];
  /** Whether the plugin list is loading. */
  loading: boolean;
  /** Callback invoked when the user toggles a plugin's enabled state. */
  onSetPluginEnabled: (name: string, enabled: boolean) => void;
}

/** Settings panel for managing Grackle plugins. */
export function PluginsPanel({ plugins, loading, onSetPluginEnabled }: PluginsPanelProps): JSX.Element {
  return (
    <div className={styles.container} data-testid="plugins-panel">
      <h2 className={styles.heading}>Plugins</h2>
      <div className={styles.section}>
        <p className={styles.sectionDescription}>
          Enable or disable optional Grackle plugins. A server restart is required for changes to take effect.
        </p>
        {loading && (
          <p className={styles.emptyState}>Loading plugins...</p>
        )}
        {!loading && plugins.length === 0 && (
          <p className={styles.emptyState}>No plugins found.</p>
        )}
        {!loading && plugins.map((plugin) => {
          const pendingChange = plugin.enabled !== plugin.loaded;
          return (
            <div
              key={plugin.name}
              className={styles.tokenRow}
              data-testid={`plugin-row-${plugin.name}`}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className={styles.tokenName}>{plugin.name}</span>
                  {plugin.required && (
                    <span className={styles.tokenBadge} title="Required — cannot be disabled">
                      required
                    </span>
                  )}
                </div>
                <div className={styles.tokenTarget}>{plugin.description}</div>
                {pendingChange && (
                  <div
                    style={{ fontSize: "var(--font-size-xs)", color: "var(--accent-yellow)", marginTop: "2px" }}
                    data-testid={`plugin-restart-notice-${plugin.name}`}
                  >
                    Restart Grackle to apply changes
                  </div>
                )}
              </div>
              <label
                style={{ display: "flex", alignItems: "center", gap: "6px", cursor: plugin.required ? "not-allowed" : "pointer" }}
                title={plugin.required ? "Core is required and cannot be disabled" : undefined}
              >
                <input
                  type="checkbox"
                  checked={plugin.enabled}
                  disabled={plugin.required}
                  onChange={(e) => onSetPluginEnabled(plugin.name, e.target.checked)}
                  data-testid={`plugin-toggle-${plugin.name}`}
                  style={{ accentColor: "var(--accent-green)", width: "16px", height: "16px" }}
                />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
