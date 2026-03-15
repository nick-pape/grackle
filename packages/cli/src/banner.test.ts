import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printBanner, getHelpFooter } from "./banner.js";

describe("printBanner", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("should print the version string", () => {
    printBanner("1.2.3");
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("1.2.3");
  });

  it("should print GRACKLE branding", () => {
    printBanner("0.0.0");
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("G R A C K L E");
  });

  it("should print the GitHub URL", () => {
    printBanner("0.0.0");
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("https://github.com/nick-pape/grackle");
  });
});

describe("getHelpFooter", () => {
  it("should contain the GitHub URL", () => {
    const footer = getHelpFooter();
    expect(footer).toContain("https://github.com/nick-pape/grackle");
  });

  it("should mention docs and issues", () => {
    const footer = getHelpFooter();
    expect(footer).toContain("Docs & issues");
  });
});
