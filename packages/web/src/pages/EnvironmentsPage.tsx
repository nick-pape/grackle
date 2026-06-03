import { type JSX } from "react";
import { Outlet } from "react-router";
import { PageHeader, buildEnvironmentsBreadcrumbs, HOME_URL } from "@grackle-ai/web-components";
import styles from "./SettingsPage.module.scss";

/** Environments hub page with breadcrumbs and routed content area. */
export function EnvironmentsPage(): JSX.Element {
  const breadcrumbs = buildEnvironmentsBreadcrumbs();

  return (
    <div className={styles.layout}>
      <PageHeader segments={breadcrumbs} backUrl={HOME_URL} />
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}
