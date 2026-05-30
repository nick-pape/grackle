import { describe, it, expect } from "vitest";
import { parsePublicOrigin } from "./public-origin.js";

describe("parsePublicOrigin", () => {
  it("accepts an https origin and returns the normalized origin", () => {
    expect(parsePublicOrigin("https://grackle.home", "TEST").origin).toBe("https://grackle.home");
  });

  it("accepts an http origin with an explicit port", () => {
    expect(parsePublicOrigin("http://grackle.home:8080", "TEST").origin).toBe(
      "http://grackle.home:8080",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(parsePublicOrigin("  https://grackle.home  ", "TEST").origin).toBe(
      "https://grackle.home",
    );
  });

  it("strips a trailing slash via origin normalization", () => {
    expect(parsePublicOrigin("https://grackle.home/", "TEST").origin).toBe("https://grackle.home");
  });

  it("rejects a non-URL value", () => {
    expect(() => parsePublicOrigin("not-a-url", "TEST")).toThrow("Invalid TEST");
  });

  it("rejects a non-http(s) scheme", () => {
    expect(() => parsePublicOrigin("ftp://grackle.home", "TEST")).toThrow(
      "Scheme must be http or https",
    );
  });

  it("rejects a URL with a path", () => {
    expect(() => parsePublicOrigin("https://grackle.home/grackle", "TEST")).toThrow(
      "bare origin with no path",
    );
  });

  it("rejects a URL with a query string", () => {
    expect(() => parsePublicOrigin("https://grackle.home?x=1", "TEST")).toThrow(
      "bare origin with no path",
    );
  });

  it("rejects embedded userinfo (credentials)", () => {
    expect(() => parsePublicOrigin("https://user:pass@grackle.home", "TEST")).toThrow(
      "must not contain a username or password",
    );
  });

  it("does not echo the raw value when rejecting userinfo (no credential leak)", () => {
    let message = "";
    try {
      parsePublicOrigin("https://user:s3cret@grackle.home", "TEST");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).not.toContain("s3cret");
    expect(message).not.toContain("user:");
  });
});
