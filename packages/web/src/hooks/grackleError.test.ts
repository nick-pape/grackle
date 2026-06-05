import { describe, it, expect } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { mapError, extractErrorMessage } from "./grackleError.js";

describe("mapError", () => {
  it("maps Code.Unauthenticated to 'unauthenticated'", () => {
    const err = new ConnectError("session expired", Code.Unauthenticated);
    const result = mapError(err);
    expect(result.code).toBe("unauthenticated");
    expect(result.message).toContain("session expired");
  });

  it("maps Code.Unavailable to 'unavailable'", () => {
    const err = new ConnectError("server down", Code.Unavailable);
    const result = mapError(err);
    expect(result.code).toBe("unavailable");
    expect(result.message).toContain("server down");
  });

  it("maps Code.ResourceExhausted to 'resource_exhausted'", () => {
    const err = new ConnectError("queue full", Code.ResourceExhausted);
    const result = mapError(err);
    expect(result.code).toBe("resource_exhausted");
    expect(result.message).toContain("queue full");
  });

  it("maps Code.FailedPrecondition to 'failed_precondition'", () => {
    const err = new ConnectError("not ready", Code.FailedPrecondition);
    const result = mapError(err);
    expect(result.code).toBe("failed_precondition");
    expect(result.message).toContain("not ready");
  });

  it("maps unmapped ConnectError codes to 'unknown'", () => {
    const err = new ConnectError("internal", Code.Internal);
    const result = mapError(err);
    expect(result.code).toBe("unknown");
    expect(result.message).toContain("internal");
  });

  it("maps a plain Error to 'unknown' with fallback message", () => {
    const err = new Error("something broke");
    const result = mapError(err, "Operation failed");
    expect(result).toEqual({ code: "unknown", message: "Operation failed" });
  });

  it("uses the Error message when no fallback is provided", () => {
    const err = new Error("something broke");
    const result = mapError(err);
    expect(result).toEqual({ code: "unknown", message: "something broke" });
  });

  it("maps a non-Error to 'unknown' with fallback message", () => {
    const result = mapError("string error", "Operation failed");
    expect(result).toEqual({ code: "unknown", message: "Operation failed" });
  });

  it("uses default message for non-Error without fallback", () => {
    const result = mapError(42);
    expect(result).toEqual({ code: "unknown", message: "An unexpected error occurred" });
  });
});

describe("extractErrorMessage", () => {
  it("returns ConnectError message", () => {
    const err = new ConnectError("bad request", Code.InvalidArgument);
    expect(extractErrorMessage(err, "fallback")).toContain("bad request");
  });

  it("returns fallback for plain Error", () => {
    expect(extractErrorMessage(new Error("oops"), "Operation failed")).toBe("Operation failed");
  });

  it("returns fallback for non-Error", () => {
    expect(extractErrorMessage(null, "Operation failed")).toBe("Operation failed");
  });
});
