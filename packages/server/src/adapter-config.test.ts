import { describe, it, expect } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { parseAdapterConfig } from "./adapter-config.js";

describe("parseAdapterConfig", () => {
  it("returns parsed object for valid JSON", () => {
    const result = parseAdapterConfig('{"host":"localhost","port":22}');
    expect(result).toEqual({ host: "localhost", port: 22 });
  });

  it("throws ConnectError with Code.Internal for invalid JSON", () => {
    expect(() => parseAdapterConfig("not-json")).toThrow(ConnectError);
    try {
      parseAdapterConfig("{broken");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).code).toBe(Code.Internal);
      expect((err as ConnectError).message).toContain("Invalid adapter configuration");
    }
  });
});
