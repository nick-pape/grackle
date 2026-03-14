import type { ToolResult } from "./tool-registry.js";

/**
 * Wrap arbitrary data in a standard MCP tool result with JSON text content.
 * Enforces a consistent return structure across all tool handlers.
 */
export function jsonResult<T>(data: T): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}
