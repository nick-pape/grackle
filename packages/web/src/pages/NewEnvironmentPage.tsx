import { type JSX } from "react";
import { Breadcrumbs } from "../components/display/index.js";
import { buildNewEnvironmentBreadcrumbs } from "../utils/breadcrumbs.js";
import styles from "../components/panels/SessionPanel.module.scss";

/** Page shown when adding a new environment. */
export function NewEnvironmentPage(): JSX.Element {
  const breadcrumbs = buildNewEnvironmentBreadcrumbs();

  return (
    <div className={styles.panelContainer}>
      <Breadcrumbs segments={breadcrumbs} />
      <div className={styles.emptyState}>
        Configure the new environment below
      </div>
    </div>
  );
}
