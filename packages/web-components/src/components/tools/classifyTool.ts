/**
 * Classifies a tool name into a rendering category.
 *
 * Maps tool names from all supported runtimes (Claude Code, Copilot, Codex)
 * to a UI category that determines which card component renders the event.
 */

/** Tool rendering categories corresponding to specialized card components. */
export type ToolCategory =
  | "file-read"
  | "file-edit"
  | "file-write"
  | "shell"
  | "search"
  | "todo"
  | "metadata"
  | "generic";

const TOOL_MAP: Record<string, ToolCategory> = {
  // File read — Claude Code: Read, Copilot: view
  read: "file-read",
  view: "file-read",

  // File edit — Claude Code: Edit, Copilot: edit, Codex: file_change
  edit: "file-edit",
  file_change: "file-edit",

  // File write — Claude Code: Write
  write: "file-write",

  // Shell — Claude Code: Bash, Codex: command_execution
  bash: "shell",
  command_execution: "shell",

  // Search — Claude Code: Grep, Glob
  grep: "search",
  glob: "search",

  // Todo — Claude Code: TodoWrite, Codex: update_plan, Goose: todo_write
  todowrite: "todo",
  update_plan: "todo",
  todo_write: "todo",

  // Metadata — Copilot: report_intent
  report_intent: "metadata",
};

/** Classifies a tool name to determine which card component should render it. */
export function classifyTool(toolName: string): ToolCategory {
  return TOOL_MAP[toolName.toLowerCase()] ?? "generic";
}
