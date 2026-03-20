import { useEffect, useMemo, type JSX } from "react";
import { motion, type Variants } from "motion/react";
import { useGrackle } from "../context/GrackleContext.js";
import {
  computeKpis,
  getActiveSessions,
  getAttentionTasks,
  getWorkspaceSnapshots,
} from "../utils/dashboard.js";
import { sessionUrl, taskUrl, workspaceUrl, useAppNavigate } from "../utils/navigation.js";
import styles from "./DashboardPage.module.scss";

// ─── Animation variants ─────────────────────────────────────────────────────

const CARD_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.3, ease: "easeOut" },
  }),
};

const SECTION_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.15 + i * 0.08, duration: 0.35, ease: "easeOut" },
  }),
};

// ─── Sub-components ─────────────────────────────────────────────────────────

interface KpiCardProps {
  value: number;
  label: string;
  accent: string;
  index: number;
  testId: string;
}

function KpiCard({ value, label, accent, index, testId }: KpiCardProps): JSX.Element {
  return (
    <motion.div
      className={styles.kpiCard}
      data-accent={accent}
      data-testid={testId}
      variants={CARD_VARIANTS}
      initial="hidden"
      animate="visible"
      custom={index}
    >
      <span className={styles.kpiValue}>{value}</span>
      <span className={styles.kpiLabel}>{label}</span>
    </motion.div>
  );
}

// ─── Main dashboard ─────────────────────────────────────────────────────────

/** Operations dashboard showing KPIs, active sessions, attention items, and health. */
export function DashboardPage(): JSX.Element {
  const { workspaces, tasks, sessions, environments, loadTasks } = useGrackle();
  const navigate = useAppNavigate();

  // Fan-out: load tasks for every workspace on mount
  useEffect(() => {
    for (const ws of workspaces) {
      loadTasks(ws.id);
    }
  }, [workspaces, loadTasks]);

  const kpis = useMemo(
    () => computeKpis(sessions, tasks, environments),
    [sessions, tasks, environments],
  );

  const activeSessions = useMemo(
    () => getActiveSessions(sessions, environments),
    [sessions, environments],
  );

  const attentionTasks = useMemo(
    () => getAttentionTasks(tasks, workspaces),
    [tasks, workspaces],
  );

  const workspaceSnapshots = useMemo(
    () => getWorkspaceSnapshots(workspaces, tasks, environments),
    [workspaces, tasks, environments],
  );

  return (
    <div className={styles.dashboard} data-testid="dashboard">
      {/* ── KPI Strip ── */}
      <div className={styles.kpiStrip} data-testid="dashboard-kpi-strip">
        <KpiCard value={kpis.activeSessions} label="Active Sessions" accent="green" index={0} testId="kpi-active-sessions" />
        <KpiCard value={kpis.blockedTasks} label="Blocked Tasks" accent="yellow" index={1} testId="kpi-blocked-tasks" />
        <KpiCard value={kpis.attentionTasks} label="Needs Attention" accent="red" index={2} testId="kpi-attention-tasks" />
        <KpiCard value={kpis.unhealthyEnvironments} label="Unhealthy Envs" accent="blue" index={3} testId="kpi-unhealthy-envs" />
      </div>

      {/* ── Main body ── */}
      <div className={styles.bodyGrid}>
        {/* Active Sessions */}
        <motion.div
          className={styles.section}
          variants={SECTION_VARIANTS}
          initial="hidden"
          animate="visible"
          custom={0}
          data-testid="dashboard-active-sessions"
        >
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}>●</span>
            <span className={styles.sectionTitle}>Active Sessions</span>
            <span className={styles.sectionCount}>{activeSessions.length}</span>
          </div>
          <div className={styles.sectionBody}>
            {activeSessions.length === 0 ? (
              <div className={styles.emptyHint}>No active sessions</div>
            ) : (
              activeSessions.map(({ session, environmentName }) => (
                <div
                  key={session.id}
                  className={styles.sessionRow}
                  onClick={() => navigate(sessionUrl(session.id))}
                  data-testid="session-row"
                >
                  <span className={styles.sessionPrompt} title={session.prompt}>
                    {session.prompt || "—"}
                  </span>
                  <span className={styles.sessionEnv}>{environmentName}</span>
                  <span className={styles.sessionRuntime}>{session.runtime}</span>
                  <span className={styles.sessionStatus}>
                    <span className={styles.statusDot} data-status={session.status} />
                    {session.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </motion.div>

        {/* Needs Attention */}
        <motion.div
          className={styles.section}
          variants={SECTION_VARIANTS}
          initial="hidden"
          animate="visible"
          custom={1}
          data-testid="dashboard-needs-attention"
        >
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}>⚑</span>
            <span className={styles.sectionTitle}>Needs Attention</span>
            <span className={styles.sectionCount}>{attentionTasks.length}</span>
          </div>
          <div className={styles.sectionBody}>
            {attentionTasks.length === 0 ? (
              <div className={styles.emptyHint}>All clear</div>
            ) : (
              attentionTasks.map(({ task, reason, workspaceName }) => (
                <div
                  key={task.id}
                  className={styles.attentionRow}
                  onClick={() => navigate(taskUrl(task.id))}
                  data-testid="attention-row"
                >
                  <div className={styles.attentionTitle}>
                    <span className={styles.reasonBadge} data-reason={reason}>
                      {reason}
                    </span>
                    {task.title}
                  </div>
                  <div className={styles.attentionMeta}>
                    <span>{workspaceName}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Bottom panels ── */}
      <div className={styles.bottomGrid}>
        {/* Environment Health */}
        <motion.div
          className={styles.section}
          variants={SECTION_VARIANTS}
          initial="hidden"
          animate="visible"
          custom={2}
          data-testid="dashboard-env-health"
        >
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}>◈</span>
            <span className={styles.sectionTitle}>Environment Health</span>
            <span className={styles.sectionCount}>{environments.length}</span>
          </div>
          <div className={styles.sectionBody}>
            {environments.length === 0 ? (
              <div className={styles.emptyHint}>No environments configured</div>
            ) : (
              environments.map((env) => (
                <div key={env.id} className={styles.envRow} data-testid="env-row">
                  <span className={styles.envName}>{env.displayName}</span>
                  <span className={styles.envStatusBadge} data-status={env.status}>
                    {env.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </motion.div>

        {/* Workspace Snapshot */}
        <motion.div
          className={styles.section}
          variants={SECTION_VARIANTS}
          initial="hidden"
          animate="visible"
          custom={3}
          data-testid="dashboard-workspace-snapshot"
        >
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}>▦</span>
            <span className={styles.sectionTitle}>Workspaces</span>
            <span className={styles.sectionCount}>{workspaces.length}</span>
          </div>
          <div className={styles.sectionBody}>
            {workspaceSnapshots.length === 0 ? (
              <div className={styles.emptyHint}>No workspaces yet</div>
            ) : (
              workspaceSnapshots.map(({ workspace, totalTasks, completedTasks, workingTasks, failedTasks }) => {
                const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
                return (
                  <div
                    key={workspace.id}
                    className={styles.workspaceRow}
                    onClick={() => navigate(workspaceUrl(workspace.id))}
                    data-testid="workspace-row"
                  >
                    <div className={styles.workspaceTop}>
                      <span className={styles.workspaceName}>{workspace.name}</span>
                      <span className={styles.workspaceCounts}>
                        {completedTasks}/{totalTasks}
                        {workingTasks > 0 && <span style={{ color: "var(--accent-green)" }}>▸{workingTasks}</span>}
                        {failedTasks > 0 && <span style={{ color: "var(--accent-red)" }}>✗{failedTasks}</span>}
                      </span>
                    </div>
                    {totalTasks > 0 && (
                      <div className={styles.progressBar}>
                        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
