/**
 * AgentSessionsTab — shows all sessions spawned by this agent (#1419).
 * Filters the global session list to sessions whose tasks are owned by
 * this agent, then renders a {@link SessionsTable}.
 *
 * @module
 */

import { useMemo, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { SessionsTable, sessionUrl, taskUrl, useAppNavigate } from "@grackle-ai/web-components";
import { useAgentContext } from "../AgentLayout.js";
import styles from "./AgentSessionsTab.module.scss";

export function AgentSessionsTab(): JSX.Element {
  const { agent } = useAgentContext();
  const navigate = useAppNavigate();
  const {
    tasks: { tasks },
    sessions: { sessions },
    environments: { environments },
    personas: { personas },
  } = useGrackle();

  const agentTaskIds = useMemo(
    () => new Set(tasks.filter((t) => t.agentId === agent.id).map((t) => t.id)),
    [tasks, agent.id],
  );

  const agentSessions = useMemo(
    () => sessions.filter((s) => s.taskId && agentTaskIds.has(s.taskId)),
    [sessions, agentTaskIds],
  );

  if (agentSessions.length === 0) {
    return (
      <div className={styles.empty} data-testid="agent-sessions-tab-empty">
        <p>No sessions yet. Sessions will appear here once this agent starts running.</p>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="agent-sessions-tab">
      <SessionsTable
        sessions={agentSessions}
        environments={environments}
        tasks={tasks}
        personas={personas}
        onOpenSession={(sessionId) => navigate(sessionUrl(sessionId))}
        onOpenTask={(taskId) => navigate(taskUrl(taskId))}
      />
    </div>
  );
}
