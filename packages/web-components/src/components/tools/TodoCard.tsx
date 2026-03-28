import { type JSX, type ReactNode } from "react";
import { Check, Circle, ListChecks } from "lucide-react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { ICON_SM, ICON_MD } from "../../utils/iconSize.js";
import styles from "./toolCards.module.scss";
import todoStyles from "./TodoCard.module.scss";

/** A normalized todo item used for rendering. */
interface TodoItem {
  /** Display text (e.g. "Get bread"). */
  content: string;
  /** Present-tense description shown when in-progress (e.g. "Getting bread"). */
  activeForm?: string;
  /** Lifecycle status. */
  status: "pending" | "in_progress" | "completed";
}

/** Checkbox pattern for Goose's markdown checklist: `- [x]`, `- [ ]`, `- [~]`, `- [/]` */
const CHECKBOX_PATTERN: RegExp = /^[-*]\s*\[([ xX~!/])\]\s*(.+)$/;

/**
 * Parses todo items from args across all supported runtimes.
 *
 * Handles three formats:
 * - Claude Code TodoWrite: `{ todos: [{ content, activeForm, status }] }`
 * - Codex update_plan:     `{ plan: [{ step, status }] }`
 * - Goose todo_write:      `{ content: "markdown checklist" }`
 */
function parseTodos(args: unknown): TodoItem[] {
  if (args === undefined || typeof args !== "object" || args === null) {
    return [];
  }
  const a = args as Record<string, unknown>;

  // Claude Code: { todos: [...] }
  if (Array.isArray(a.todos)) {
    return (a.todos as unknown[])
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).content === "string" &&
          typeof (item as Record<string, unknown>).status === "string",
      )
      .map((item) => ({
        content: item.content as string,
        activeForm: typeof item.activeForm === "string" ? item.activeForm : undefined,
        status: normalizeStatus(item.status as string),
      }));
  }

  // Codex: { plan: [{ step, status }] }
  if (Array.isArray(a.plan)) {
    return (a.plan as unknown[])
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).step === "string" &&
          typeof (item as Record<string, unknown>).status === "string",
      )
      .map((item) => ({
        content: item.step as string,
        status: normalizeStatus(item.status as string),
      }));
  }

  // Goose: { content: "markdown checklist" }
  if (typeof a.content === "string") {
    return parseMarkdownChecklist(a.content);
  }

  return [];
}

/** Normalizes status strings across runtimes to our three canonical values. */
function normalizeStatus(status: string): "pending" | "in_progress" | "completed" {
  switch (status.toLowerCase()) {
    case "completed":
    case "done":
    case "complete":
      return "completed";
    case "in_progress":
    case "in-progress":
    case "working":
    case "active":
      return "in_progress";
    default:
      return "pending";
  }
}

/** Parses a markdown checklist string (Goose format) into TodoItems. */
function parseMarkdownChecklist(content: string): TodoItem[] {
  const lines: string[] = content.split("\n");
  const items: TodoItem[] = [];
  for (const line of lines) {
    const match: RegExpExecArray | null = CHECKBOX_PATTERN.exec(line.trim());
    if (match) {
      const marker: string = match[1];
      const text: string = match[2].trim();
      let status: "pending" | "in_progress" | "completed" = "pending";
      if (marker === "x" || marker === "X") {
        status = "completed";
      } else if (marker === "~" || marker === "/" || marker === "!") {
        status = "in_progress";
      }
      items.push({ content: text, status });
    }
  }
  return items;
}

/** Status icon for a todo item. */
function statusIcon(status: string): ReactNode {
  switch (status) {
    case "completed":
      return <Check size={ICON_SM} />;
    case "in_progress":
      return <Circle size={ICON_SM} fill="currentColor" />;
    default:
      return <Circle size={ICON_SM} />;
  }
}

/** Renders a TodoWrite tool call as a compact checklist. */
export function TodoCard({ args }: ToolCardProps): JSX.Element {
  const todos = parseTodos(args);
  const completed: number = todos.filter((t) => t.status === "completed").length;
  const inProgress: TodoItem | undefined = todos.find((t) => t.status === "in_progress");
  const isEmpty: boolean = todos.length === 0;

  return (
    <div
      className={`${styles.card} ${styles.cardBlue}`}
      data-testid="tool-card-todo"
    >
      <div className={styles.header}>
        <span className={styles.icon}><ListChecks size={ICON_MD} /></span>
        <span className={styles.toolName} style={{ color: "var(--accent-blue)" }}>
          {isEmpty ? "Todos cleared" : "Todos"}
        </span>
        {!isEmpty && (
          <>
            <span className={styles.spacer} />
            <span className={styles.badge} data-testid="tool-card-todo-progress">
              {completed}/{todos.length}
            </span>
          </>
        )}
      </div>

      {/* Progress bar */}
      {!isEmpty && (
        <div className={todoStyles.progressBar} data-testid="tool-card-todo-bar">
          <div
            className={todoStyles.progressFill}
            style={{ width: `${(completed / todos.length) * 100}%` }}
          />
        </div>
      )}

      {/* Active task callout */}
      {inProgress && (
        <div className={todoStyles.activeTask} data-testid="tool-card-todo-active">
          <span className={todoStyles.activeIcon}><Circle size={ICON_SM} fill="currentColor" /></span>
          <span className={todoStyles.activeText}>
            {inProgress.activeForm || inProgress.content}
          </span>
        </div>
      )}

      {/* Checklist */}
      {!isEmpty && (
        <div className={todoStyles.checklist} data-testid="tool-card-todo-list">
          {todos.map((todo, i) => (
            <div
              key={i}
              className={`${todoStyles.item} ${todoStyles[todo.status]}`}
              data-testid="tool-card-todo-item"
            >
              <span className={todoStyles.itemIcon}>
                {statusIcon(todo.status)}
              </span>
              <span className={todoStyles.itemText}>
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      )}

      {isEmpty && (
        <div className={todoStyles.emptyMessage}>
          All items completed and cleared.
        </div>
      )}
    </div>
  );
}
