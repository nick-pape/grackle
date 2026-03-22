import { useMemo, type JSX } from "react";
import type { TaskData } from "../../hooks/useGrackleSocket.js";
import { useGrackle } from "../../context/GrackleContext.js";
import { buildBoardColumns, type BoardTask } from "../../utils/boardColumns.js";
import { getStatusStyle } from "../../utils/taskStatus.js";
import { taskUrl, newTaskUrl, useAppNavigate } from "../../utils/navigation.js";
import { AnimatePresence, motion } from "motion/react";
import styles from "./WorkspaceBoard.module.scss";

/** Props for the WorkspaceBoard component. */
interface WorkspaceBoardProps {
  workspaceId: string;
  environmentId: string;
}

/** Kanban-style board view with fixed columns for each task status. */
export function WorkspaceBoard({ workspaceId, environmentId }: WorkspaceBoardProps): JSX.Element {
  const { tasks, sessions, personas, environments } = useGrackle();
  const navigate = useAppNavigate();

  const workspaceTasks = useMemo(
    () => tasks.filter((t) => t.workspaceId === workspaceId),
    [tasks, workspaceId],
  );

  const taskStatusById = useMemo(
    () => new Map(tasks.map((t) => [t.id, t.status])),
    [tasks],
  );

  const tasksById = useMemo(
    () => new Map(workspaceTasks.map((t) => [t.id, t])),
    [workspaceTasks],
  );

  const boardMetadataByTaskId = useMemo(() => {
    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const personaById = new Map(personas.map((p) => [p.id, p]));
    const environmentById = new Map(environments.map((e) => [e.id, e]));
    const sessionStatusByTaskId = new Map<string, string>();
    const personaNameByTaskId = new Map<string, string>();
    const environmentNameByTaskId = new Map<string, string>();

    for (const task of workspaceTasks) {
      if (task.latestSessionId) {
        const session = sessionById.get(task.latestSessionId);
        if (session) {
          sessionStatusByTaskId.set(task.id, session.status);

          if (session.personaId) {
            const persona = personaById.get(session.personaId);
            if (persona) {
              personaNameByTaskId.set(task.id, persona.name);
            }
          }

          if (session.environmentId) {
            const environment = environmentById.get(session.environmentId);
            if (environment) {
              environmentNameByTaskId.set(task.id, environment.displayName);
            }
          }
        }
      }
    }

    return {
      sessionStatusByTaskId,
      personaNameByTaskId,
      environmentNameByTaskId,
    };
  }, [workspaceTasks, sessions, personas, environments]);

  const columns = useMemo(
    () => buildBoardColumns({
      tasks: workspaceTasks,
      taskStatusById,
      sessionStatusByTaskId: boardMetadataByTaskId.sessionStatusByTaskId,
    }),
    [workspaceTasks, taskStatusById, boardMetadataByTaskId],
  );

  if (workspaceTasks.length === 0) {
    return (
      <div className={styles.emptyCta} data-testid="board-empty-cta">
        <button
          className={styles.ctaButton}
          onClick={() => navigate(newTaskUrl(workspaceId, undefined, environmentId))}
        >
          Create Task
        </button>
        <div className={styles.ctaDescription}>
          Break your work into tasks and let agents tackle them
        </div>
      </div>
    );
  }

  return (
    <div className={styles.boardContainer} data-testid="board-container">
      {columns.map((col) => (
        <section
          key={col.status}
          className={styles.column}
          data-testid={`board-column-${col.status}`}
          aria-label={`${col.label}, ${col.tasks.length} ${col.tasks.length === 1 ? "task" : "tasks"}`}
        >
          <div className={styles.columnHeader}>
            <span className={styles.columnIcon} style={{ color: col.style.color }}>
              {col.style.icon}
            </span>
            <span className={styles.columnLabel}>{col.label}</span>
            <span className={styles.columnCount} data-testid={`board-count-${col.status}`}>
              {col.tasks.length}
            </span>
          </div>
          <div className={styles.cardList}>
            {col.tasks.length === 0 ? (
              <div className={styles.emptyPlaceholder}>No tasks</div>
            ) : (
              <AnimatePresence mode="popLayout">
                {col.tasks.map((bt) => (
                  <motion.div
                    key={bt.task.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                  >
                    <BoardCard
                      boardTask={bt}
                      tasksById={tasksById}
                      personaName={boardMetadataByTaskId.personaNameByTaskId.get(bt.task.id)}
                      envName={boardMetadataByTaskId.environmentNameByTaskId.get(bt.task.id)}
                      onClick={() => navigate(taskUrl(bt.task.id, undefined, workspaceId, environmentId))}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BoardCard
// ---------------------------------------------------------------------------

interface BoardCardProps {
  boardTask: BoardTask;
  tasksById: Map<string, TaskData>;
  personaName?: string;
  envName?: string;
  onClick: () => void;
}

/** Individual card rendered inside a board column. */
function BoardCard({ boardTask, tasksById, personaName, envName, onClick }: BoardCardProps): JSX.Element {
  const { task, isBlocked, childCount, doneChildCount, pausedSubBadge } = boardTask;
  const statusStyle = getStatusStyle(task.status);
  const parentTask = task.parentTaskId ? tasksById.get(task.parentTaskId) : undefined;

  return (
    <div
      className={styles.card}
      tabIndex={0}
      role="button"
      data-testid={`board-card-${task.id}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className={styles.cardHeader}>
        <span className={styles.cardStatusIcon} style={{ color: statusStyle.color }}>
          {statusStyle.icon}
        </span>
        <span className={styles.cardTitle}>{task.title}</span>
      </div>
      <div className={styles.cardBadges}>
        {parentTask && (
          <span className={`${styles.badge} ${styles.parentBadge}`} title={parentTask.title}>
            {parentTask.title}
          </span>
        )}
        {childCount > 0 && (
          <span className={`${styles.badge} ${styles.childBadge}`}>
            {doneChildCount}/{childCount}
          </span>
        )}
        {isBlocked && (
          <span className={`${styles.badge} ${styles.blockedBadge}`}>
            blocked
          </span>
        )}
        {task.dependsOn.length > 0 && !isBlocked && (
          <span className={`${styles.badge} ${styles.depBadge}`}>
            dep
          </span>
        )}
        {pausedSubBadge && (
          <span className={`${styles.badge} ${styles.pausedSubBadge}`}>
            {pausedSubBadge}
          </span>
        )}
        {personaName && (
          <span className={`${styles.badge} ${styles.personaBadge}`}>
            {personaName}
          </span>
        )}
        {envName && (
          <span className={`${styles.badge} ${styles.envBadge}`}>
            {envName}
          </span>
        )}
      </div>
    </div>
  );
}
