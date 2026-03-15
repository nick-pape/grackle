import { ConnectError, Code } from "@connectrpc/connect";
import type { ToolResult } from "./tool-registry.js";

/** Map of gRPC status code numbers to human-readable names. */
const CODE_NAMES: Record<number, string> = {
  [Code.Canceled]: "CANCELLED",
  [Code.Unknown]: "UNKNOWN",
  [Code.InvalidArgument]: "INVALID_ARGUMENT",
  [Code.DeadlineExceeded]: "DEADLINE_EXCEEDED",
  [Code.NotFound]: "NOT_FOUND",
  [Code.AlreadyExists]: "ALREADY_EXISTS",
  [Code.PermissionDenied]: "PERMISSION_DENIED",
  [Code.ResourceExhausted]: "RESOURCE_EXHAUSTED",
  [Code.FailedPrecondition]: "FAILED_PRECONDITION",
  [Code.Aborted]: "ABORTED",
  [Code.OutOfRange]: "OUT_OF_RANGE",
  [Code.Unimplemented]: "UNIMPLEMENTED",
  [Code.Internal]: "INTERNAL",
  [Code.Unavailable]: "UNAVAILABLE",
  [Code.DataLoss]: "DATA_LOSS",
  [Code.Unauthenticated]: "UNAUTHENTICATED",
};

/**
 * Convert a gRPC ConnectError into a structured MCP tool error result.
 * Non-ConnectError exceptions are re-thrown.
 */
export function grpcErrorToToolResult(error: unknown): ToolResult {
  if (error instanceof ConnectError) {
    const codeName = (CODE_NAMES as Partial<Record<number, string>>)[error.code] ?? "UNKNOWN";
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: error.message, code: codeName }, null, 2),
        },
      ],
      isError: true,
    };
  }
  throw error;
}
