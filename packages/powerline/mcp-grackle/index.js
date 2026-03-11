#!/usr/bin/env node
/**
 * Grackle MCP Server — Provides coordination tools for agents running in containers.
 *
 * Tools:
 *   - post_finding: Post a finding for the current project (intercepted by runtime)
 *   - query_findings: Query findings from other agents (stub — context injected at spawn)
 *
 * The actual finding storage is handled by the claude-code runtime which intercepts
 * tool_use events for "post_finding" and emits "finding" events in the stream.
 * The Grackle server then stores them in SQLite.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "grackle",
  version: "0.1.0",
});

server.tool(
  "post_finding",
  "Share a discovery with other agents working on this project. Use this for architecture decisions, bugs found, API patterns, dependency notes, or any insight that would help other agents.",
  {
    title: z.string().describe("Short descriptive title for the finding"),
    content: z.string().describe("Detailed description of the finding"),
    category: z
      .enum(["architecture", "api", "bug", "decision", "dependency", "pattern", "general"])
      .optional()
      .describe("Category of the finding (default: general)"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional tags for filtering"),
  },
  async ({ title, content, category, tags }) => {
    // The claude-code runtime intercepts this tool_use event and emits a "finding"
    // event in the stream. We just return a confirmation here.
    const cat = category || "general";
    const tagStr = tags && tags.length > 0 ? ` [${tags.join(", ")}]` : "";
    return {
      content: [
        {
          type: "text",
          text: `Finding posted (${cat}${tagStr}): ${title}`,
        },
      ],
    };
  }
);

server.tool(
  "create_subtask",
  "Delegate work to another agent by creating a child task. Use this when work is too large or complex for you to complete alone, or when a different specialization is needed. Each subtask runs in its own agent session.",
  {
    title: z.string().describe("Short descriptive title for the subtask"),
    description: z.string().describe("Detailed description of what to do and what 'done' looks like"),
    local_id: z
      .string()
      .optional()
      .describe("Assign a local ID to reference this subtask in depends_on of later subtasks"),
    depends_on: z
      .array(z.string())
      .optional()
      .describe("Local IDs of sibling subtasks that must finish first"),
    can_decompose: z
      .boolean()
      .optional()
      .describe("Set true if the subtask itself may need further decomposition (default: false)"),
  },
  async ({ title, description, local_id, depends_on, can_decompose }) => {
    // The runtime intercepts this tool_use event and emits a "subtask_create"
    // event in the stream. We just return a confirmation here.
    const localId = local_id || `subtask-${Date.now()}`;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ status: "subtask_queued", local_id: localId, title }),
        },
      ],
    };
  }
);

server.tool(
  "query_findings",
  "Query findings posted by other agents in this project. Findings from previous tasks are also included in your system context automatically.",
  {
    category: z
      .enum(["architecture", "api", "bug", "decision", "dependency", "pattern", "general"])
      .optional()
      .describe("Filter by category"),
  },
  async () => {
    // Findings are injected into the agent's system context at spawn time via
    // buildFindingsContext(). This tool exists for discoverability but the
    // real data comes from the prompt.
    return {
      content: [
        {
          type: "text",
          text: "Findings from other agents are included in your system context above. Check the 'Project Findings' section.",
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
