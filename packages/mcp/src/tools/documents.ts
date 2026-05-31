import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { DOCUMENT_SHOW_META_KEY, type DocumentShowDescriptor } from "../document-show-meta.js";

/** Build an INVALID_ARGUMENT tool error result. */
function invalidArgument(message: string): ToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: message, code: "INVALID_ARGUMENT" }, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * Live-docs tools (#1396 v0).
 *
 * `show_file` opens a read-only, live-updating view of a file in the Grackle
 * document pane. The handler returns a {@link DocumentShowDescriptor} on the
 * result `_meta`; the broker capture in `mcp-server.ts` reads it and emits a
 * `document.show` domain event carrying the URI **reference** (not baked
 * content). The web renders the file via the AHP resource bridge (#1395) and
 * refreshes it whenever the file changes on disk.
 */
export const documentsTools: ToolDefinition[] = [
  {
    name: "show_file",
    group: "document",
    description:
      "Open a read-only, live-updating view of a file in the user's Grackle document pane. Pass an absolute path to a file in your working tree; the pane renders markdown richly and other text/code with syntax highlighting, and refreshes automatically as the file changes. Use this to show the user a plan, report, or file you are working on.",
    inputSchema: z.object({
      path: z.string().describe("Absolute path to the file to display."),
    }),
    rpcMethod: "showFile",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>) {
      const path = args.path as string;
      if (!path || !isAbsolute(path)) {
        return invalidArgument(
          "path must be an absolute filesystem path (e.g. /home/user/repo/plan.md).",
        );
      }
      const uri = pathToFileURL(path).href;
      const descriptor: DocumentShowDescriptor = { uri };
      return {
        ...jsonResult({ shown: true, uri }),
        _meta: { [DOCUMENT_SHOW_META_KEY]: descriptor },
      };
    },
  },
];
