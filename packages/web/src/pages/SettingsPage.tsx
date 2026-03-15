import { type JSX } from "react";
import { Breadcrumbs } from "../components/display/index.js";
import { SettingsPanel } from "../components/panels/SettingsPanel.js";
import { buildSettingsBreadcrumbs } from "../utils/breadcrumbs.js";
import styles from "../components/panels/SessionPanel.module.scss";

/** Settings page wrapping the SettingsPanel with breadcrumbs. */
export function SettingsPage(): JSX.Element {
  const breadcrumbs = buildSettingsBreadcrumbs();

  return (
    <div className={styles.panelContainer}>
      <Breadcrumbs segments={breadcrumbs} />
      <SettingsPanel />
    </div>
  );
}
