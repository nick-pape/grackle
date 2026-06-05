/**
 * Transport-agnostic error mapping.
 *
 * This is the only file in the web package that imports ConnectError/Code from
 * the transport layer. All other hooks and pages import from here instead.
 *
 * @module
 */

import { ConnectError, Code } from "@connectrpc/connect";

/** Transport-agnostic error codes the UI layer may branch on. */
export type GrackleErrorCode =
  | "unauthenticated"
  | "unavailable"
  | "resource_exhausted"
  | "failed_precondition"
  | "unknown";

/** A transport-agnostic error with a UI-friendly code and message. */
export interface GrackleError {
  code: GrackleErrorCode;
  message: string;
}

/** Map a gRPC status code to a {@link GrackleErrorCode}. */
function mapCode(code: number): GrackleErrorCode {
  switch (code) {
    case Code.Unauthenticated:
      return "unauthenticated";
    case Code.Unavailable:
      return "unavailable";
    case Code.ResourceExhausted:
      return "resource_exhausted";
    case Code.FailedPrecondition:
      return "failed_precondition";
    default:
      return "unknown";
  }
}

/**
 * Map any caught error to a {@link GrackleError}.
 *
 * ConnectErrors are mapped to their UI-friendly code with the original message.
 * All other errors fall back to `"unknown"` with the provided fallback message.
 */
export function mapError(err: unknown, fallbackMessage?: string): GrackleError {
  if (err instanceof ConnectError) {
    return { code: mapCode(err.code), message: err.message };
  }
  const message =
    fallbackMessage ?? (err instanceof Error ? err.message : "An unexpected error occurred");
  return { code: "unknown", message };
}

/**
 * Extract a user-facing message string from a caught error.
 *
 * Convenience wrapper around {@link mapError} for sites that only need the
 * message and don't branch on the error code.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ConnectError) {
    return err.message;
  }
  return fallback;
}
