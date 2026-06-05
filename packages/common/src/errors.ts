import { Code } from "@connectrpc/connect";

export { Code } from "@connectrpc/connect";

/**
 * Base error for all Grackle domain errors.
 *
 * Carries a gRPC-compatible status code and an optional context bag for
 * structured metadata (entity IDs, field names, etc.). The server-side
 * interceptor translates this to a ConnectError at the gRPC boundary.
 */
export class GrackleError extends Error {
  /** gRPC status code that the interceptor maps to ConnectError. */
  public readonly code: Code;

  /** Structured metadata for logging and diagnostics. */
  public readonly context: Readonly<Record<string, unknown>>;

  public constructor(
    message: string,
    code: Code = Code.Internal,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "GrackleError";
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}

/** Thrown when a required field is missing or a value is malformed. */
export class ValidationError extends GrackleError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, Code.InvalidArgument, context);
    this.name = "ValidationError";
  }
}

/** Thrown when a referenced entity does not exist. */
export class NotFoundError extends GrackleError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, Code.NotFound, context);
    this.name = "NotFoundError";
  }
}

/** Thrown when an operation cannot proceed because the system is in the wrong state. */
export class PreconditionError extends GrackleError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, Code.FailedPrecondition, context);
    this.name = "PreconditionError";
  }
}

/** Thrown when the caller lacks permission for the operation. */
export class AuthError extends GrackleError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, Code.PermissionDenied, context);
    this.name = "AuthError";
  }
}

/** Thrown when creating an entity that already exists. */
export class ConflictError extends GrackleError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, Code.AlreadyExists, context);
    this.name = "ConflictError";
  }
}

/** Thrown when a resource is temporarily unavailable. */
export class UnavailableError extends GrackleError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, Code.Unavailable, context);
    this.name = "UnavailableError";
  }
}
