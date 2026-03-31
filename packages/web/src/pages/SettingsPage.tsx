import { type JSX } from "react";
import { Outlet, useLocation } from "react-router";
import { Breadcrumbs, buildSettingsBreadcrumbs } from "@grackle-ai/web-components";
import styles from "./SettingsPage.module.scss";

/** Maps settings URL path segments to display labels. */
const SETTINGS_TAB_LABELS: Record<string, string> = {
  credentials: "Credentials",
  personas: "Personas",
  schedules: "Schedules",
  appearance: "Appearance",
  about: "About",
  shortcuts: "Shortcuts",
  plugins: "Plugins",
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
