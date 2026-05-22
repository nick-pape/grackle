import { z } from "zod";
import type { ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { HELLO_WIDGET_URI } from "../resources/hello-widget.js";

/**
 * MCP Apps widget tools. The `uiResourceUri` ties each tool to a `ui://` HTML
 * resource the host renders; these tools are only listed to hosts that advertise
 * the `io.modelcontextprotocol/ui` extension (see `mcp-server.ts` gating).
 */
export const widgetTools: ToolDefinition[] = [
  {
    name: "show_hello_widget",
    group: "widget",
    description:
      "Display the Grackle hello widget — a minimal interactive MCP Apps UI that echoes the provided message. Renders inline in hosts that support MCP Apps.",
    inputSchema: z.object({
      message: z.string().optional().describe("Message to echo back in the widget."),
    }),
    rpcMethod: "showHelloWidget",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    uiResourceUri: HELLO_WIDGET_URI,
    async handler(args: Record<string, unknown>) {
      const message: string = typeof args.message === "string" ? args.message : "Hello from Grackle";
      return jsonResult({ message, renderedAt: new Date().toISOString() });
    },
  },
];
