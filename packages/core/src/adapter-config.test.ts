import { describe, it, expect } from "vitest";
import { Code } from "@connectrpc/connect";
import { GrackleError } from "@grackle-ai/common";
import { parseAdapterConfig } from "./adapter-config.js";

describe("parseAdapterConfig", () => {
  it("returns parsed object for valid JSON", () => {
    const result = parseAdapterConfig('{"host":"localhost","port":22}');
    expect(result).toEqual({ host: "localhost", port: 22 });
  });

  it("throws GrackleError with Code.Internal for invalid JSON", () => {
    expect(() => parseAdapterConfig("{broken")).toThrowError(
      expect.objectContaining({
        code: Code.Internal,
        message: expect.stringContaining("Invalid adapter configuration"),
      }),
    );
  });

  it("throws GrackleError with Code.Internal for null", () => {
    expect(() => parseAdapterConfig("null")).toThrow(GrackleError);
    expect(() => parseAdapterConfig("null")).toThrowError(
      expect.objectContaining({ code: Code.Internal }),
    );
  });

  it("throws GrackleError with Code.Internal for arrays", () => {
    expect(() => parseAdapterConfig("[1,2]")).toThrow(GrackleError);
    expect(() => parseAdapterConfig("[1,2]")).toThrowError(
      expect.objectContaining({ code: Code.Internal }),
    );
  });

  it("throws GrackleError with Code.Internal for primitives", () => {
    expect(() => parseAdapterConfig("42")).toThrow(GrackleError);
    expect(() => parseAdapterConfig('"string"')).toThrow(GrackleError);
  });
});
