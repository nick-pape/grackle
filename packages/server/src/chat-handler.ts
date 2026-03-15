import type http from "node:http";
import { createClaudeCode } from "ai-sdk-provider-claude-code";
import { streamText } from "ai";
import { verifyApiKey } from "./api-key.js";
import { logger } from "./logger.js";

/** Collect the full JSON body from an incoming request. */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** MCP tool names exposed by the Grackle MCP server, prefixed for Claude Code. */
const ALLOWED_MCP_TOOLS: string[] = [
  // environments
  "mcp__grackle__env_list", "mcp__grackle__env_add", "mcp__grackle__env_provision",
  "mcp__grackle__env_stop", "mcp__grackle__env_destroy", "mcp__grackle__env_remove",
  "mcp__grackle__env_wake",
  // projects
  "mcp__grackle__project_list", "mcp__grackle__project_create", "mcp__grackle__project_get",
  "mcp__grackle__project_update", "mcp__grackle__project_archive",
  // tasks
  "mcp__grackle__task_list", "mcp__grackle__task_create", "mcp__grackle__task_show",
  "mcp__grackle__task_update", "mcp__grackle__task_start", "mcp__grackle__task_delete",
  "mcp__grackle__task_approve", "mcp__grackle__task_reject", "mcp__grackle__task_import_github",
  // sessions
  "mcp__grackle__session_spawn", "mcp__grackle__session_resume", "mcp__grackle__session_status",
  "mcp__grackle__session_kill", "mcp__grackle__session_attach", "mcp__grackle__session_send_input",
  // findings
  "mcp__grackle__finding_list", "mcp__grackle__finding_post",
  // personas
  "mcp__grackle__persona_list", "mcp__grackle__persona_create", "mcp__grackle__persona_show",
  "mcp__grackle__persona_edit", "mcp__grackle__persona_delete",
  // logs
  "mcp__grackle__logs_get",
];

/** Built-in Claude Code tools that must NOT be used — only MCP domain tools. */
const DISALLOWED_BUILTIN_TOOLS: string[] = [
  "Bash", "Read", "Write", "Edit", "Glob", "Grep",
  "NotebookEdit", "WebFetch", "WebSearch",
  "TodoWrite", "TodoRead", "Agent",
];

/**
 * Create an HTTP handler for POST /api/chat.
 * Streams an AI response using Claude Code with Grackle MCP tools.
 */
export function createChatHandler(
  mcpPort: number,
  bindHost: string,
  apiKey: string,
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const urlHost = bindHost.includes(":") ? `[${bindHost}]` : bindHost;

  const provider = createClaudeCode({
    defaultSettings: {
      systemPrompt: "You are Grackle, an AI assistant for managing development environments, tasks, and projects. Use the available MCP tools to help the user. Be concise.",
      mcpServers: {
        grackle: {
          type: "http",
          url: `http://${urlHost}:${mcpPort}/mcp`,
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      },
      allowedTools: ALLOWED_MCP_TOOLS,
      disallowedTools: DISALLOWED_BUILTIN_TOOLS,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
    },
  });

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Auth check
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!verifyApiKey(token)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    let messages: Array<{ role: string; content: string }>;
    try {
      const body = JSON.parse(await readBody(req));
      messages = body.messages;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    try {
      const result = streamText({
        model: provider("haiku"),
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      });

      result.pipeTextStreamToResponse(res);
    } catch (err) {
      logger.error({ err }, "Chat handler error");
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  };
}
