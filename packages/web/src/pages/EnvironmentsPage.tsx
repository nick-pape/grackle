import { type JSX } from "react";
import { Outlet } from "react-router";
import { Breadcrumbs } from "@grackle-ai/web-components/src/components/display/index.js";
import { buildEnvironmentsBreadcrumbs } from "@grackle-ai/web-components/src/utils/breadcrumbs.js";
import styles from "./SettingsPage.module.scss";

/** Environments hub page with breadcrumbs and routed content area. */
export function EnvironmentsPage(): JSX.Element {
  const breadcrumbs = buildEnvironmentsBreadcrumbs();

  return (
    <div className={styles.layout}>
      <Breadcrumbs segments={breadcrumbs} />
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}
