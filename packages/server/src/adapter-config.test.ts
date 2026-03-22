import { describe, it, expect } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { parseAdapterConfig } from "./adapter-config.js";

describe("parseAdapterConfig", () => {
  it("returns parsed object for valid JSON", () => {
    const result = parseAdapterConfig('{"host":"localhost","port":22}');
    expect(result).toEqual({ host: "localhost", port: 22 });
  });

  it("throws ConnectError with Code.Internal for invalid JSON", () => {
    expect(() => parseAdapterConfig("{broken")).toThrowError(
      expect.objectContaining({
        code: Code.Internal,
        message: expect.stringContaining("Invalid adapter configuration"),
      }),
    );
  });

  it("throws ConnectError with Code.Internal for null", () => {
    expect(() => parseAdapterConfig("null")).toThrow(ConnectError);
    expect(() => parseAdapterConfig("null")).toThrowError(
      expect.objectContaining({ code: Code.Internal }),
    );
  });

  it("throws ConnectError with Code.Internal for arrays", () => {
    expect(() => parseAdapterConfig("[1,2]")).toThrow(ConnectError);
    expect(() => parseAdapterConfig("[1,2]")).toThrowError(
      expect.objectContaining({ code: Code.Internal }),
    );
  });

  it("throws ConnectError with Code.Internal for primitives", () => {
    expect(() => parseAdapterConfig("42")).toThrow(ConnectError);
    expect(() => parseAdapterConfig('"string"')).toThrow(ConnectError);
  });
});
