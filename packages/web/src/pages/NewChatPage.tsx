import { type JSX } from "react";
import { useSearchParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { Breadcrumbs, ChatInput, buildNewChatBreadcrumbs, useToast } from "@grackle-ai/web-components";
import styles from "./page-layout.module.scss";

/** Page shown when starting a new chat session. */
export function NewChatPage(): JSX.Element {
  const breadcrumbs = buildNewChatBreadcrumbs();
  const [searchParams] = useSearchParams();
  const envId = searchParams.get("env") ?? "";
  const { sessions: { sendInput, spawn }, tasks: { startTask }, personas: { personas }, environments: { environments, provisionEnvironment } } = useGrackle();
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
        onSendInput={(sid, text) => { sendInput(sid, text).catch(() => {}); }}
        onSpawn={(eid, prompt, pid) => { spawn(eid, prompt, pid).catch(() => {}); }}
        onStartTask={(tid, pid, eid) => { startTask(tid, pid, eid).catch(() => {}); }}
        onProvisionEnvironment={(eid) => { provisionEnvironment(eid).catch(() => {}); }}
        onShowToast={showToast}
      />
    </div>
  );
}
