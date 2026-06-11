import { type CSSProperties, type JSX } from "react";
import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { MatchIndex } from "@grackle-ai/common";
import { ICON_SM } from "../../utils/iconSize.js";
import { taskUrl } from "../../utils/navigation.js";
import type { useAppNavigate } from "../../utils/navigation.js";
import { getStatusStyle, resolveStatus } from "../../utils/taskStatus.js";
import { HighlightedText, type StatusGroup } from "./listHelpers.js";
import styles from "./TaskList.module.scss";

/** Base left-padding for task rows. */
const TASK_BASE_INDENT_PX: number = 16;

/** Props for the StatusGroupAccordion component. */
export interface StatusGroupAccordionProps {
  /** The status group to render. */
  group: StatusGroup;
  /** Whether the accordion is currently expanded. */
  isExpanded: boolean;
  /** Called when the user toggles the accordion. */
  onToggle: () => void;
  /** ID of the currently selected task, if any. */
  selectedTaskId: string | undefined;
  /** Navigate function from useAppNavigate. */
  navigate: ReturnType<typeof useAppNavigate>;
  /** Per-task title highlight indices for matched search queries. */
  titleHighlights: Map<string, readonly MatchIndex[]>;
  /** Workspace name lookup by workspace ID. */
  workspaceNames: Map<string, string>;
}

/** Collapsible accordion for a single task status group. */
export function StatusGroupAccordion({
  group,
  isExpanded,
  onToggle,
  selectedTaskId,
  navigate,
  titleHighlights,
  workspaceNames,
}: StatusGroupAccordionProps): JSX.Element {
  return (
    <div data-testid={`status-group-${group.status}`}>
      <div
        className={styles.statusGroupHeader}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span
          className={`${styles.expandArrow} ${isExpanded ? styles.expanded : ""}`}
          aria-hidden="true"
        >
          <ChevronRight size={ICON_SM} />
        </span>
        <span
          className={styles.statusGroupIcon}
          style={{ color: group.style.color }}
          aria-hidden="true"
        >
          {group.style.icon}
        </span>
        <span className={styles.statusGroupLabel}>{group.label}</span>
        <span className={styles.statusGroupCount}>{group.tasks.length}</span>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            {group.tasks.map((task) => {
              const statusStyle = getStatusStyle(task.status);
              const isSelected = selectedTaskId === task.id;
              const wsName =
                task.parentTaskId || !task.workspaceId
                  ? undefined
                  : workspaceNames.get(task.workspaceId);
              return (
                <div
                  key={task.id}
                  onClick={() => navigate(taskUrl(task.id))}
                  role="button"
                  tabIndex={0}
                  aria-label={task.title}
                  onKeyDown={(e) => {
                    if (e.currentTarget === e.target && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      navigate(taskUrl(task.id));
                    }
                  }}
                  className={`${styles.taskRow} ${isSelected ? styles.selected : ""}`}
                  style={{ "--task-indent": `${TASK_BASE_INDENT_PX}px` } as CSSProperties}
                  data-task-id={task.id}
                >
                  <span className={styles.leafSpacer} />
                  <span
                    className={styles.taskStatusIcon}
                    style={{ color: statusStyle.color }}
                    aria-hidden="true"
                    data-testid={`task-status-${resolveStatus(task.status)}`}
                  >
                    {statusStyle.icon}
                  </span>
                  <span className={styles.taskTitle} title={task.title}>
                    <HighlightedText
                      text={task.title}
                      indices={titleHighlights.get(task.id)}
                      highlightClass={styles.searchHighlight}
                    />
                  </span>
                  {wsName && (
                    <span className={styles.workspaceBadge} title={wsName}>
                      {wsName}
                    </span>
                  )}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
