import { describe, it, expect } from "vitest";
import { Code } from "@connectrpc/connect";
import {
  GrackleError,
  ValidationError,
  NotFoundError,
  PreconditionError,
  AuthError,
  ConflictError,
  UnavailableError,
} from "./errors.js";

describe("GrackleError", () => {
  it("extends Error", () => {
    const err = new GrackleError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GrackleError);
  });

  it("defaults to Code.Internal", () => {
    const err = new GrackleError("boom");
    expect(err.code).toBe(Code.Internal);
  });

  it("accepts an explicit code", () => {
    const err = new GrackleError("auth", Code.Unauthenticated);
    expect(err.code).toBe(Code.Unauthenticated);
  });

  it("has correct name and message", () => {
    const err = new GrackleError("something failed");
    expect(err.name).toBe("GrackleError");
    expect(err.message).toBe("something failed");
  });

  it("defaults to empty frozen context", () => {
    const err = new GrackleError("boom");
    expect(err.context).toEqual({});
    expect(Object.isFrozen(err.context)).toBe(true);
  });

  it("freezes provided context", () => {
    const ctx = { entityId: "abc-123" };
    const err = new GrackleError("boom", Code.Internal, ctx);
    expect(err.context).toEqual({ entityId: "abc-123" });
    expect(Object.isFrozen(err.context)).toBe(true);
  });

  it("does not share reference with the input context object", () => {
    const ctx = { key: "value" };
    const err = new GrackleError("boom", Code.Internal, ctx);
    ctx.key = "mutated";
    expect(err.context.key).toBe("value");
  });
});

describe("subclasses", () => {
  const cases: Array<{
    name: string;
    ErrorClass: new (msg: string, ctx?: Record<string, unknown>) => GrackleError;
    expectedCode: Code;
    expectedName: string;
  }> = [
    {
      name: "ValidationError",
      ErrorClass: ValidationError,
      expectedCode: Code.InvalidArgument,
      expectedName: "ValidationError",
    },
    {
      name: "NotFoundError",
      ErrorClass: NotFoundError,
      expectedCode: Code.NotFound,
      expectedName: "NotFoundError",
    },
    {
      name: "PreconditionError",
      ErrorClass: PreconditionError,
      expectedCode: Code.FailedPrecondition,
      expectedName: "PreconditionError",
    },
    {
      name: "AuthError",
      ErrorClass: AuthError,
      expectedCode: Code.PermissionDenied,
      expectedName: "AuthError",
    },
    {
      name: "ConflictError",
      ErrorClass: ConflictError,
      expectedCode: Code.AlreadyExists,
      expectedName: "ConflictError",
    },
    {
      name: "UnavailableError",
      ErrorClass: UnavailableError,
      expectedCode: Code.Unavailable,
      expectedName: "UnavailableError",
    },
  ];

  it.each(cases)("$name maps to the correct gRPC code", ({ ErrorClass, expectedCode }) => {
    const err = new ErrorClass("test message");
    expect(err.code).toBe(expectedCode);
  });

  it.each(cases)("$name has correct name", ({ ErrorClass, expectedName }) => {
    const err = new ErrorClass("test");
    expect(err.name).toBe(expectedName);
  });

  it.each(cases)("$name instanceof GrackleError", ({ ErrorClass }) => {
    const err = new ErrorClass("test");
    expect(err).toBeInstanceOf(GrackleError);
    expect(err).toBeInstanceOf(Error);
  });

  it.each(cases)("$name instanceof its own class", ({ ErrorClass }) => {
    const err = new ErrorClass("test");
    expect(err).toBeInstanceOf(ErrorClass);
  });

  it.each(cases)("$name accepts context", ({ ErrorClass }) => {
    const err = new ErrorClass("test", { id: "x" });
    expect(err.context).toEqual({ id: "x" });
    expect(Object.isFrozen(err.context)).toBe(true);
  });
});
