import type { JSX } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TaskData, Session, Environment, Workspace, UsageStats } from "../../hooks/types.js";
import { getStatusStyle, getStatusBadgeClassKey } from "../../utils/taskStatus.js";
import { formatCost, formatTokens } from "../../utils/format.js";
import { WorkpadPanel } from "./WorkpadPanel.js";
import styles from "./TaskOverviewPanel.module.scss";

// --- Internal helpers --------------------------------------------------------

function formatDate(iso: string | undefined): string {
  if (!iso) {
    return "\u2014";
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return "\u2014";
  }
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(start: string | undefined, end: string | undefined): string | undefined {
  if (!start || !end) {
    return undefined;
  }
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms) || ms < 0) {
    return undefined;
  }
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins === 0) {
    return `${secs}s`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours === 0) {
    return `${mins}m ${secs}s`;
  }
  return `${hours}h ${remMins}m`;
}

function envStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "ready" || s === "running" || s === "available" || s === "connected") {
    return styles.envDotGreen;
  }
  if (s === "provisioning" || s === "starting" || s === "pending" || s === "connecting") {
    return styles.envDotYellow;
  }
  if (s === "error" || s === "failed" || s === "disconnected") {
    return styles.envDotRed;
  }
  return styles.envDotGray;
}

function TaskStatusBadge({ status }: { status: string }): JSX.Element {
  const style = getStatusStyle(status);
  const classKey = getStatusBadgeClassKey(status);
  return (
    <span
      className={`${styles.statusBadge} ${styles[classKey] ?? styles.statusPending}`}
      data-testid="task-overview-status-badge"
    >
      {style.label}
    </span>
  );
}

// --- Public component --------------------------------------------------------

/** Props for {@link TaskOverviewPanel}. */
export interface TaskOverviewPanelProps {
  /** The task to display. */
  task: TaskData;
  /** Lookup map for dependency resolution. */
  tasksById: Map<string, TaskData>;
  /** All available environments. */
  environments: Environment[];
  /** All workspaces. */
  workspaces: Workspace[];
  /** Sessions belonging to this task. */
  taskSessions: Session[];
  /** The currently selected environment id (from workspace default or user pick). */
  selectedEnvId: string;
  /** Usage stats for this task only. */
  taskUsage?: UsageStats;
  /** Aggregate usage stats including subtasks. */
  treeUsage?: UsageStats;
}

/**
 * Renders the overview tab content for a task detail page.
 *
 * Displays status badge, branch link, description (markdown), environment,
 * dependencies, timeline, usage/cost, and review notes.
 */
export function TaskOverviewPanel({
  task, tasksById, environments, workspaces, taskSessions,
  selectedEnvId, taskUsage, treeUsage,
}: TaskOverviewPanelProps): JSX.Element {
  const latestSession = taskSessions.length > 0 ? taskSessions[taskSessions.length - 1] : undefined;
  const envId = latestSession?.environmentId ?? "";
  const env = envId ? environments.find((e) => e.id === envId) : undefined;
  const workspace = workspaces.find((p) => p.id === task.workspaceId);
  const selectedEnv = environments.find((e) => e.id === selectedEnvId);
  const branchUrl = task.branch && workspace?.repoUrl
    ? `${workspace.repoUrl.replace(/\/$/, "")}/tree/${encodeURIComponent(task.branch)}`
    : undefined;

  return (
    <div className={styles.overviewDashboard} data-testid="task-overview-panel">
      <div className={styles.overviewHero}>
        <TaskStatusBadge status={task.status} />
        {task.branch && (
          <span className={styles.overviewBranchPill} data-testid="task-overview-branch">
            {branchUrl ? (
              <a href={branchUrl} target="_blank" rel="noreferrer noopener" className={styles.branchLink}>
                {"\u{1F517}"} {task.branch}
              </a>
            ) : (
              <span>{"\u{1F517}"} {task.branch}</span>
            )}
          </span>
        )}
      </div>
      {typeof task.description === "string" && task.description && (
        <div className={styles.overviewSection} data-testid="task-overview-description">
          <div className={styles.overviewLabel}>Description</div>
          <div className={styles.overviewMarkdown}>
            <Markdown remarkPlugins={[remarkGfm]}>{task.description}</Markdown>
          </div>
        </div>
      )}
      {task.workpad && <WorkpadPanel workpad={task.workpad} />}
      <div className={styles.overviewSection}>
        <div className={styles.overviewLabel}>Environment</div>
        {envId && env ? (
          <div className={styles.envRow} data-testid="task-overview-environment">
            <span className={`${styles.envDot} ${envStatusClass(env.status)}`} title={env.status} aria-label={`Status: ${env.status}`} role="img" />
            <span className={styles.overviewValue}>{env.displayName}</span>
          </div>
        ) : selectedEnv ? (
          <div className={styles.envRow} data-testid="task-overview-environment">
            <span className={`${styles.envDot} ${envStatusClass(selectedEnv.status)}`} title={selectedEnv.status} aria-label={`Status: ${selectedEnv.status}`} role="img" />
            <span className={styles.overviewValue}>{selectedEnv.displayName}</span>
            <span className={styles.overviewMuted}>(workspace default)</span>
          </div>
        ) : (
          <div className={styles.overviewMuted}>Set in workspace settings</div>
        )}
      </div>
      <div className={styles.overviewSection} data-testid="task-overview-dependencies">
        <div className={styles.overviewLabel}>Dependencies</div>
        {task.dependsOn.length === 0 ? (
          <div className={styles.overviewMuted}>None</div>
        ) : (
          <div className={styles.depList}>
            {task.dependsOn.map((depId) => {
              const dep = tasksById.get(depId);
              const isDone = dep?.status === "complete";
              return (
                <div key={depId} className={`${styles.depItem} ${isDone ? styles.depDone : styles.depBlocked}`}>
                  <span>{isDone ? "\u2713" : "\u25CB"}</span>
                  <span>{dep?.title ?? depId}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className={styles.overviewSection} data-testid="task-overview-timeline">
        <div className={styles.overviewLabel}>Timeline</div>
        <div className={styles.timeline}>
          {task.createdAt && (
            <div className={styles.timelineRow}>
              <span className={styles.timelineKey}>Created</span>
              <span className={styles.timelineValue}>{formatDate(task.createdAt)}</span>
            </div>
          )}
          {task.assignedAt && (() => {
            const delta = formatDuration(task.createdAt, task.assignedAt);
            return (
              <div className={styles.timelineRow}>
                <span className={styles.timelineKey}>Assigned</span>
                <span className={styles.timelineValue}>{formatDate(task.assignedAt)}</span>
                {delta !== undefined && <span className={styles.timelineDelta}>{delta}</span>}
              </div>
            );
          })()}
          {task.startedAt && (() => {
            const delta = formatDuration(task.assignedAt ?? task.createdAt, task.startedAt);
            return (
              <div className={styles.timelineRow}>
                <span className={styles.timelineKey}>Started</span>
                <span className={styles.timelineValue}>{formatDate(task.startedAt)}</span>
                {delta !== undefined && <span className={styles.timelineDelta}>{delta}</span>}
              </div>
            );
          })()}
          {task.completedAt && (() => {
            const delta = formatDuration(task.startedAt, task.completedAt);
            return (
              <div className={styles.timelineRow}>
                <span className={styles.timelineKey}>Completed</span>
                <span className={styles.timelineValue}>{formatDate(task.completedAt)}</span>
                {delta !== undefined && <span className={styles.timelineDelta}>{delta}</span>}
              </div>
            );
          })()}
          {!task.createdAt && !task.assignedAt && !task.startedAt && !task.completedAt && (
            <div className={styles.overviewMuted}>No timing data</div>
          )}
        </div>
      </div>
      {taskUsage && taskUsage.costUsd > 0 && (
        <div className={styles.overviewSection} data-testid="task-overview-usage">
          <div className={styles.overviewLabel}>Usage</div>
          <div className={styles.timeline}>
            <div className={styles.timelineRow}>
              <span className={styles.timelineKey}>Cost</span>
              <span className={styles.timelineValue}>{formatCost(taskUsage.costUsd)}</span>
              <span className={styles.timelineDelta}>{taskUsage.sessionCount} session{taskUsage.sessionCount !== 1 ? "s" : ""}</span>
            </div>
            {treeUsage && treeUsage.costUsd > taskUsage.costUsd && (
              <div className={styles.timelineRow}>
                <span className={styles.timelineKey}>Total (incl. subtasks)</span>
                <span className={styles.timelineValue}>{formatCost(treeUsage.costUsd)}</span>
                <span className={styles.timelineDelta}>{treeUsage.sessionCount} session{treeUsage.sessionCount !== 1 ? "s" : ""}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {(task.tokenBudget > 0 || task.costBudgetMillicents > 0) && (
        <div className={styles.overviewSection} data-testid="task-overview-budget">
          <div className={styles.overviewLabel}>Budget</div>
          <div className={styles.timeline}>
            {task.tokenBudget > 0 && (
              <div className={styles.timelineRow}>
                <span className={styles.timelineKey}>Tokens</span>
                <span className={styles.timelineValue}>
                  {formatTokens((taskUsage?.inputTokens ?? 0) + (taskUsage?.outputTokens ?? 0))} / {formatTokens(task.tokenBudget)}
                </span>
              </div>
            )}
            {task.costBudgetMillicents > 0 && (
              <div className={styles.timelineRow}>
                <span className={styles.timelineKey}>Cost</span>
                <span className={styles.timelineValue}>
                  {formatCost(taskUsage?.costUsd ?? 0)} / {formatCost(task.costBudgetMillicents / 100_000)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {task.reviewNotes && (
        <div className={styles.overviewSection} data-testid="task-overview-review-notes">
          <div className={styles.overviewLabel}>Review Notes</div>
          <div className={styles.reviewNotes}>{task.reviewNotes}</div>
        </div>
      )}
    </div>
  );
}
