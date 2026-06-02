/**
 * AgentSchedulesTab — shows this agent's heartbeat schedule and attached
 * schedules (#1419). Schedule-to-agent attachment (#1439) is pending; for
 * now only the heartbeat is shown.
 *
 * @module
 */

import type { JSX } from "react";
import {
  agentUrl,
  useAppNavigate,
  formatCountdown,
  formatRelativeTime,
} from "@grackle-ai/web-components";
import { useAgentContext } from "../AgentLayout.js";
import styles from "./AgentSchedulesTab.module.scss";

export function AgentSchedulesTab(): JSX.Element {
  const { agent } = useAgentContext();
  const navigate = useAppNavigate();
  const heartbeat = agent.heartbeat;

  if (!heartbeat) {
    return (
      <div className={styles.empty} data-testid="agent-schedules-tab-empty">
        <p>No schedules configured for this agent.</p>
        <button
          className={styles.ctaButton}
          onClick={() => navigate(agentUrl(agent.id, "settings"))}
          data-testid="agent-schedules-configure-cta"
        >
          Configure Heartbeat
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="agent-schedules-tab">
      <div className={styles.card} data-testid="agent-schedules-heartbeat-card">
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Heartbeat</h3>
          <span className={heartbeat.enabled ? styles.badgeActive : styles.badgePaused}>
            {heartbeat.enabled ? "Active" : "Paused"}
          </span>
        </div>
        <dl className={styles.fields}>
          <dt>Cadence</dt>
          <dd>{heartbeat.scheduleExpression}</dd>
          {heartbeat.enabled && heartbeat.nextRunAt && (
            <>
              <dt>Next wake</dt>
              <dd>{formatCountdown(heartbeat.nextRunAt)}</dd>
            </>
          )}
          {heartbeat.lastRunAt && (
            <>
              <dt>Last run</dt>
              <dd>{formatRelativeTime(heartbeat.lastRunAt)}</dd>
            </>
          )}
          <dt>Run count</dt>
          <dd>{heartbeat.runCount}</dd>
        </dl>
        {heartbeat.description && (
          <div className={styles.rules}>
            <h4 className={styles.rulesTitle}>Rules</h4>
            <p className={styles.rulesText}>{heartbeat.description}</p>
          </div>
        )}
      </div>
    </div>
  );
}
