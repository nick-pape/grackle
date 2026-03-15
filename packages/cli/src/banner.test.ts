import { describe, it, expect } from "vitest";
import { renderBanner, getHelpFooter } from "./banner.js";

describe("renderBanner", () => {
  it("should contain the version string", () => {
    const output = renderBanner("1.2.3");
    expect(output).toContain("1.2.3");
  });

  it("should contain GRACKLE branding", () => {
    const output = renderBanner("0.0.0");
    expect(output).toContain("G R A C K L E");
  });

  it("should contain the GitHub URL", () => {
    const output = renderBanner("0.0.0");
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
