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
  | "finding"
  | "task"
  | "workpad"
  | "knowledge"
  | "ipc"
  | "tool-search"
  | "generic";

/** Known MCP server names for bare-name extraction from Copilot dash format. */
const KNOWN_MCP_SERVERS: Set<string> = new Set(["grackle"]);

/**
 * Extracts the bare tool name from runtime-specific naming conventions.
 *
 * - Claude Code / Codex: `mcp__grackle__finding_post` -> `finding_post`
 * - Copilot: `grackle-finding_post` -> `finding_post`
 * - Built-in: `Read` -> `read` (unchanged, lowered later)
 */
export function extractBareName(toolName: string): string {
  // MCP double-underscore format: mcp__<server>__<tool> (only for known servers)
  if (toolName.startsWith("mcp__")) {
    const serverSep = toolName.indexOf("__", 5);
    if (serverSep > 5) {
      const server = toolName.slice(5, serverSep);
      if (KNOWN_MCP_SERVERS.has(server)) {
        return toolName.slice(serverSep + 2);
      }
    }
  }
  // Copilot dash format: <server>-<tool> (only for known servers)
  const dashIndex = toolName.indexOf("-");
  if (dashIndex > 0) {
    const server = toolName.slice(0, dashIndex);
    if (KNOWN_MCP_SERVERS.has(server)) {
      return toolName.slice(dashIndex + 1);
    }
  }
  return toolName;
}

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

  // Finding — Grackle MCP
  finding_post: "finding",
  finding_list: "finding",

  // Task — Grackle MCP
  task_list: "task",
  task_create: "task",
  task_show: "task",
  task_update: "task",
  task_start: "task",
  task_complete: "task",
  task_resume: "task",
  task_delete: "task",

  // Workpad — Grackle MCP
  workpad_write: "workpad",
  workpad_read: "workpad",

  // Knowledge — Grackle MCP
  knowledge_search: "knowledge",
  knowledge_get_node: "knowledge",
  knowledge_create_node: "knowledge",

  // IPC — Grackle MCP
  ipc_spawn: "ipc",
  ipc_write: "ipc",
  ipc_close: "ipc",
  ipc_list_fds: "ipc",
  ipc_terminate: "ipc",
  ipc_create_stream: "ipc",
  ipc_attach: "ipc",

  // ToolSearch — Claude Code built-in
  toolsearch: "tool-search",
};

/** Classifies a tool name to determine which card component should render it. */
export function classifyTool(toolName: string): ToolCategory {
  const bare = extractBareName(toolName);
  return TOOL_MAP[bare.toLowerCase()] ?? "generic";
}
