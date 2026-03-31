import { z } from "zod";
import type { GrackleClients, ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** MCP tool for checking the Grackle server version status. */
export const versionTools: ToolDefinition[] = [
  {
    name: "get_version_status",
    group: "system",
    description:
      "Check if a newer version of Grackle is available. Returns the current and latest versions, whether an update is available, and whether the server is running in Docker.",
    inputSchema: z.object({}),
    rpcMethod: "getVersionStatus",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler(_args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const status = await client.getVersionStatus({});
        return jsonResult({
          currentVersion: status.currentVersion,
          latestVersion: status.latestVersion,
          updateAvailable: status.updateAvailable,
          isDocker: status.isDocker,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
