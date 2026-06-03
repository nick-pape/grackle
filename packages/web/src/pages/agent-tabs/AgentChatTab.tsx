/**
 * AgentChatTab — the default agent tab showing the root session transcript.
 * Finds the agent's root task, loads its latest session events, and renders
 * an {@link EventStream} with optional {@link ChatInput} for interaction.
 *
 * @module
 */

import { useEffect, useMemo, useRef, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { useSandboxProxyUrl } from "../../context/ManifestContext.js";
import {
  EventStream,
  ChatInput,
  groupConsecutiveTextEvents,
  pairToolEvents,
  useToast,
} from "@grackle-ai/web-components";
import { useAgentContext } from "../AgentLayout.js";
import styles from "./AgentChatTab.module.scss";

/** Session statuses that indicate the session is alive. */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["pending", "running", "idle"]);

export function AgentChatTab(): JSX.Element {
  const { agent } = useAgentContext();
  const { showToast } = useToast();
  const sandboxProxyUrl = useSandboxProxyUrl();
  const {
    tasks: { tasks, startTask },
    sessions: {
      sessions,
      events,
      eventsDropped,
      taskSessions,
      loadTaskSessions,
      loadSessionEvents,
      sendInput,
    },
    environments: { environments, provisionEnvironment },
    personas: { personas },
    documents: { openDocument },
  } = useGrackle();

  const rootTask = tasks.find((t) => t.agentId === agent.id && t.kind === "root");

  const latestSession = rootTask?.latestSessionId
    ? (sessions.find((s) => s.id === rootTask.latestSessionId) ??
      (taskSessions[rootTask.id] ?? []).find((s) => s.id === rootTask.latestSessionId))
    : undefined;

  const loadedSessionRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (rootTask) {
      loadTaskSessions(rootTask.id).catch(() => {});
    }
  }, [rootTask?.id, rootTask?.latestSessionId, loadTaskSessions]);

  useEffect(() => {
    if (latestSession && latestSession.id !== loadedSessionRef.current) {
      loadedSessionRef.current = latestSession.id;
      loadSessionEvents(latestSession.id).catch(() => {});
    }
  }, [latestSession?.id, loadSessionEvents]);

  const groupedEvents = useMemo(() => {
    if (!latestSession) return [];
    const filtered = events.filter((e) => e.sessionId === latestSession.id);
    return pairToolEvents(groupConsecutiveTextEvents(filtered));
  }, [events, latestSession?.id]);

  const isActive = latestSession ? ACTIVE_STATUSES.has(latestSession.status) : false;
  const showSend = isActive || latestSession?.status === "suspended";

  const docEnvironmentId = latestSession?.environmentId;

  if (!rootTask) {
    return (
      <div className={styles.empty} data-testid="agent-chat-tab-empty">
        <p>This agent has no root task yet. It will be created automatically.</p>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="agent-chat-tab">
      <div className={styles.stream}>
        <EventStream
          events={groupedEvents}
          eventsDropped={eventsDropped}
          sandboxProxyUrl={sandboxProxyUrl}
          emptyState={
            <div className={styles.emptyState}>
              <p>
                {agent.heartbeat
                  ? "Waiting for the agent to wake up..."
                  : "Configure a heartbeat in Settings to activate this agent."}
              </p>
            </div>
          }
          onShowToast={showToast}
          onOpenDocument={
            docEnvironmentId
              ? (uri) => openDocument({ environmentId: docEnvironmentId, uri }, { focus: true })
              : undefined
          }
        />
      </div>
      <ChatInput
        mode={showSend ? "send" : "start"}
        sessionId={showSend ? latestSession!.id : undefined}
        taskId={rootTask.id}
        environmentId={
          showSend
            ? latestSession!.environmentId
            : (environments.find((e) => e.id === agent.environmentId)?.id ?? environments[0]?.id)
        }
        personas={personas}
        environments={environments}
        onSendInput={(sid, text) => {
          sendInput(sid, text).catch(() => {
            showToast("Failed to send message", "error");
          });
        }}
        onSpawn={() => {}}
        onStartTask={(taskId, personaId, environmentId, notes) => {
          startTask(taskId, personaId, environmentId, notes).catch(() => {
            showToast("Failed to start task", "error");
          });
        }}
        onProvisionEnvironment={(eid) => {
          provisionEnvironment(eid).catch(() => {});
        }}
        onShowToast={showToast}
      />
    </div>
  );
}
