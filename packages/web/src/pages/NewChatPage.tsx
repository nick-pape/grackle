import { type JSX } from "react";
import { useSearchParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { useToast } from "@grackle-ai/web-components";
import { Breadcrumbs } from "@grackle-ai/web-components";
import { ChatInput } from "@grackle-ai/web-components";
import { buildNewChatBreadcrumbs } from "@grackle-ai/web-components";
import styles from "@grackle-ai/web-components/src/components/panels/SessionPanel.module.scss";

/** Page shown when starting a new chat session. */
export function NewChatPage(): JSX.Element {
  const breadcrumbs = buildNewChatBreadcrumbs();
  const [searchParams] = useSearchParams();
  const envId = searchParams.get("env") ?? "";
  const { sendInput, spawn, startTask, personas, environments, provisionEnvironment } = useGrackle();
  const { showToast } = useToast();

  return (
    <div className={styles.panelContainer}>
      <Breadcrumbs segments={breadcrumbs} />
      <div className={styles.emptyState}>
        Enter a prompt below to start a new session
      </div>
      <ChatInput
        mode="spawn"
        environmentId={envId}
        showPersonaSelect
        personas={personas}
        environments={environments}
        onSendInput={sendInput}
        onSpawn={spawn}
        onStartTask={startTask}
        onProvisionEnvironment={provisionEnvironment}
        onShowToast={showToast}
      />
    </div>
  );
}
