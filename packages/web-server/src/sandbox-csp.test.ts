import { describe, it, expect } from "vitest";
import { buildCspHeader } from "./sandbox-csp.js";

describe("buildCspHeader", () => {
  it("locks down by default (no domains)", () => {
    const csp = buildCspHeader(undefined);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' blob:");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    // No unsafe-inline / unsafe-eval in script-src.
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
  });

  it("widens script-src + connect-src with allowed domains", () => {
    const csp = buildCspHeader({
      resourceDomains: ["http://127.0.0.1:7435"],
      connectDomains: ["http://127.0.0.1:7435"],
    });
    expect(csp).toContain("script-src 'self' blob: http://127.0.0.1:7435");
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:7435");
  });

  it("sanitizes domain entries that could break out of a directive", () => {
    const csp = buildCspHeader({
      resourceDomains: ["http://ok.example", "evil.com; script-src *", "has space", "has\"quote"],
    });
    expect(csp).toContain("http://ok.example");
    expect(csp).not.toContain("evil.com");
    expect(csp).not.toContain("has space");
    expect(csp).not.toContain('has"quote');
  });

  it("allows inline styles (widgets use <style>) but not inline scripts", () => {
    const csp = buildCspHeader(undefined);
    expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
