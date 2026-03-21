import { type JSX } from "react";
import { useSearchParams } from "react-router";
import { Breadcrumbs } from "../components/display/index.js";
import { ChatInput } from "../components/chat/index.js";
import { buildNewChatBreadcrumbs } from "../utils/breadcrumbs.js";
import styles from "../components/panels/SessionPanel.module.scss";

/** Page shown when starting a new chat session. */
export function NewChatPage(): JSX.Element {
  const breadcrumbs = buildNewChatBreadcrumbs();
  const [searchParams] = useSearchParams();
  const envId = searchParams.get("env") ?? "";

  return (
    <div className={styles.panelContainer}>
      <Breadcrumbs segments={breadcrumbs} />
      <div className={styles.emptyState}>
        Enter a prompt below to start a new session
      </div>
      <ChatInput mode="spawn" environmentId={envId} showPersonaSelect />
    </div>
  );
}
