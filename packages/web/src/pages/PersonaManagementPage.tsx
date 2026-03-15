import { type JSX } from "react";
import { Breadcrumbs } from "../components/display/index.js";
import { PersonaManager } from "../components/personas/PersonaManager.js";
import { buildPersonasBreadcrumbs } from "../utils/breadcrumbs.js";
import styles from "../components/panels/SessionPanel.module.scss";

/** Persona management page wrapping PersonaManager with breadcrumbs. */
export function PersonaManagementPage(): JSX.Element {
  const breadcrumbs = buildPersonasBreadcrumbs();

  return (
    <div className={styles.panelContainer}>
      <Breadcrumbs segments={breadcrumbs} />
      <PersonaManager />
    </div>
  );
}
