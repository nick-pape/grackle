import { type JSX } from "react";
import { Outlet, useLocation } from "react-router";
import { Breadcrumbs } from "../components/display/index.js";
import { buildSettingsBreadcrumbs } from "../utils/breadcrumbs.js";
import styles from "./SettingsPage.module.scss";

/** Maps settings URL path segments to display labels. */
const SETTINGS_TAB_LABELS: Record<string, string> = {
  credentials: "Credentials",
  personas: "Personas",
  appearance: "Appearance",
  about: "About",
  shortcuts: "Shortcuts",
};

/** Settings hub with breadcrumbs and tab content area. */
export function SettingsPage(): JSX.Element {
  const location = useLocation();
  const tabSegment = location.pathname.replace(/^\/settings\/?/, "").split("/")[0];
  const tabLabel = SETTINGS_TAB_LABELS[tabSegment];
  const breadcrumbs = buildSettingsBreadcrumbs(tabLabel);

  return (
    <div className={styles.layout}>
      <Breadcrumbs segments={breadcrumbs} />
      <div className={styles.content}>
        <div key={tabSegment} className={styles.tabPanel}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
