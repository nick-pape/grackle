import { describe, expect, it } from "vitest";
import { envString, envOptionalString, envPort, envInt, envNum, envFlag, envBool } from "./env.js";

describe("envString", () => {
  it("returns the env value when set", () => {
    expect(envString("X", "default", { X: "hello" })).toBe("hello");
  });

  it("returns fallback when unset", () => {
    expect(envString("X", "default", {})).toBe("default");
  });

  it("returns fallback when empty", () => {
    expect(envString("X", "default", { X: "" })).toBe("default");
  });
});

describe("envOptionalString", () => {
  it("returns the value when set", () => {
    expect(envOptionalString("X", { X: "val" })).toBe("val");
  });

  it("returns undefined when unset", () => {
    expect(envOptionalString("X", {})).toBeUndefined();
  });

  it("returns undefined when empty", () => {
    expect(envOptionalString("X", { X: "" })).toBeUndefined();
  });
});

describe("envPort", () => {
  it("returns fallback when unset", () => {
    expect(envPort("PORT", 3000, {})).toBe(3000);
  });

  it("parses a valid port", () => {
    expect(envPort("PORT", 3000, { PORT: "8080" })).toBe(8080);
  });

  it("accepts port 1", () => {
    expect(envPort("PORT", 3000, { PORT: "1" })).toBe(1);
  });

  it("accepts port 65535", () => {
    expect(envPort("PORT", 3000, { PORT: "65535" })).toBe(65535);
  });

  it("throws on port 0", () => {
    expect(() => envPort("PORT", 3000, { PORT: "0" })).toThrow('Invalid port for PORT: "0"');
  });

  it("throws on port 65536", () => {
    expect(() => envPort("PORT", 3000, { PORT: "65536" })).toThrow(
      'Invalid port for PORT: "65536"',
    );
  });

  it("throws on non-integer", () => {
    expect(() => envPort("PORT", 3000, { PORT: "3.14" })).toThrow("Invalid port");
  });

  it("throws on non-numeric", () => {
    expect(() => envPort("PORT", 3000, { PORT: "abc" })).toThrow("Invalid port");
  });

  it("returns fallback when empty", () => {
    expect(envPort("PORT", 3000, { PORT: "" })).toBe(3000);
  });
});

describe("envInt", () => {
  it("returns fallback when unset", () => {
    expect(envInt("X", 10, {})).toBe(10);
  });

  it("parses a valid integer", () => {
    expect(envInt("X", 10, { env: { X: "42" } })).toBe(42);
  });

  it("truncates a positive float toward zero", () => {
    expect(envInt("X", 10, { env: { X: "3.9" } })).toBe(3);
  });

  it("truncates a negative float toward zero", () => {
    expect(envInt("X", 10, { env: { X: "-1.2" } })).toBe(-1);
  });

  it("returns fallback when below min", () => {
    expect(envInt("X", 10, { min: 5, env: { X: "2" } })).toBe(10);
  });

  it("returns fallback when above max", () => {
    expect(envInt("X", 10, { max: 100, env: { X: "200" } })).toBe(10);
  });

  it("returns fallback on NaN", () => {
    expect(envInt("X", 10, { env: { X: "abc" } })).toBe(10);
  });

  it("returns fallback on empty", () => {
    expect(envInt("X", 10, { env: { X: "" } })).toBe(10);
  });

  it("parses negative integers", () => {
    expect(envInt("X", 0, { env: { X: "-5" } })).toBe(-5);
  });
});

describe("envNum", () => {
  it("returns fallback when unset", () => {
    expect(envNum("X", 0.5, {})).toBe(0.5);
  });

  it("parses a float", () => {
    expect(envNum("X", 0.5, { X: "0.35" })).toBe(0.35);
  });

  it("parses zero", () => {
    expect(envNum("X", 0.5, { X: "0" })).toBe(0);
  });

  it("returns fallback on negative", () => {
    expect(envNum("X", 0.5, { X: "-1" })).toBe(0.5);
  });

  it("returns fallback on NaN", () => {
    expect(envNum("X", 0.5, { X: "nope" })).toBe(0.5);
  });

  it("returns fallback on Infinity", () => {
    expect(envNum("X", 0.5, { X: "Infinity" })).toBe(0.5);
  });
});

describe("envFlag", () => {
  it("returns true for '1'", () => {
    expect(envFlag("X", { X: "1" })).toBe(true);
  });

  it("returns false for '0'", () => {
    expect(envFlag("X", { X: "0" })).toBe(false);
  });

  it("returns false for 'true'", () => {
    expect(envFlag("X", { X: "true" })).toBe(false);
  });

  it("returns false when unset", () => {
    expect(envFlag("X", {})).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(envFlag("X", { X: "" })).toBe(false);
  });
});

describe("envBool", () => {
  it("returns true for '1'", () => {
    expect(envBool("X", false, { X: "1" })).toBe(true);
  });

  it("returns true for 'true'", () => {
    expect(envBool("X", false, { X: "true" })).toBe(true);
  });

  it("returns true for 'TRUE'", () => {
    expect(envBool("X", false, { X: "TRUE" })).toBe(true);
  });

  it("returns false for '0'", () => {
    expect(envBool("X", true, { X: "0" })).toBe(false);
  });

  it("returns false for 'false'", () => {
    expect(envBool("X", true, { X: "false" })).toBe(false);
  });

  it("returns fallback when unset", () => {
    expect(envBool("X", true, {})).toBe(true);
    expect(envBool("X", false, {})).toBe(false);
  });

  it("returns fallback when empty", () => {
    expect(envBool("X", true, { X: "" })).toBe(true);
  });

  it("returns fallback for unrecognized values", () => {
    expect(envBool("X", true, { X: "nope" })).toBe(true);
    expect(envBool("X", false, { X: "yes" })).toBe(false);
  });
});
