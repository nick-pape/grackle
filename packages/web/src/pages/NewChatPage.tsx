import { type JSX } from "react";
import { Breadcrumbs } from "../components/display/index.js";
import { buildNewChatBreadcrumbs } from "../utils/breadcrumbs.js";
import styles from "../components/panels/SessionPanel.module.scss";

/** Page shown when starting a new chat session. */
export function NewChatPage(): JSX.Element {
  const breadcrumbs = buildNewChatBreadcrumbs();

  return (
    <div className={styles.panelContainer}>
      <Breadcrumbs segments={breadcrumbs} />
      <div className={styles.emptyState}>
        Enter a prompt below to start a new session
      </div>
    </div>
  );
}
