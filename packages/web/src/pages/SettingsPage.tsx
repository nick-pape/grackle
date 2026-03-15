import { type JSX } from "react";
import { Outlet } from "react-router";
import { Breadcrumbs } from "../components/display/index.js";
import { buildSettingsBreadcrumbs } from "../utils/breadcrumbs.js";
import styles from "./SettingsPage.module.scss";

/** Settings hub with breadcrumbs and tab content area. */
export function SettingsPage(): JSX.Element {
  const breadcrumbs = buildSettingsBreadcrumbs();

  return (
    <div className={styles.layout}>
      <Breadcrumbs segments={breadcrumbs} />
      <div className={styles.content} role="tabpanel">
        <Outlet />
      </div>
    </div>
  );
}
