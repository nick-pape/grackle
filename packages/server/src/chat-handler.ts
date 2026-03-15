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
