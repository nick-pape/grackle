import { ConnectError, Code } from "@connectrpc/connect";

/**
 * Parse a JSON adapter configuration string, throwing a gRPC Internal error
 * if the value is not valid JSON or not a plain object.
 */
export function parseAdapterConfig(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConnectError("Invalid adapter configuration", Code.Internal);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConnectError("Invalid adapter configuration", Code.Internal);
  }
  return parsed as Record<string, unknown>;
}
