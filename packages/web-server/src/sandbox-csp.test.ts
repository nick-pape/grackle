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

  it("rejects non-origin sources (wildcards, scheme-only, paths)", () => {
    const csp = buildCspHeader({
      resourceDomains: [
        "*",
        "data:",
        "blob:",
        "https:",
        "http://ok.example/some/path",
        "http://ok.example?q=1",
        "https://good.example",
      ],
    });
    // Only the bare http(s) origin survives.
    expect(csp).toContain("https://good.example");
    expect(csp).not.toMatch(/script-src[^;]*\*/);
    expect(csp).not.toMatch(/script-src[^;]*data:/);
    expect(csp).not.toMatch(/script-src[^;]*blob: blob:/); // no duplicate scheme-only blob
    expect(csp).not.toContain("/some/path");
    expect(csp).not.toContain("?q=1");
  });

  it("allows inline scripts only when allowInlineScripts is set (agent widgets)", () => {
    const locked = buildCspHeader({ resourceDomains: ["https://ok.example"] });
    expect(locked).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    const inline = buildCspHeader({ resourceDomains: ["https://ok.example"], allowInlineScripts: true });
    expect(inline).toMatch(/script-src 'self' 'unsafe-inline' blob:/);
    // Non-boolean / falsey values do not enable it.
    expect(buildCspHeader({ allowInlineScripts: "yes" })).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("allows inline styles (widgets use <style>) but not inline scripts", () => {
    const csp = buildCspHeader(undefined);
    expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
