import { ConnectError, Code } from "@connectrpc/connect";

/**
 * Parse a JSON adapter configuration string, throwing a gRPC Internal error
 * if the value is not valid JSON.
 */
export function parseAdapterConfig(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ConnectError("Invalid adapter configuration", Code.Internal);
  }
}
