// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { grackleHostStyleVariables } from "./grackleHostStyleVariables.js";

describe("grackleHostStyleVariables", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("style");
  });

  it("always returns the MCP-standard fallback variables", () => {
    const vars = grackleHostStyleVariables();
    expect(vars["--color-background-primary"]).toBeDefined();
    expect(vars["--color-text-primary"]).toBeDefined();
    expect(vars["--font-sans"]).toBeDefined();
    expect(vars["--border-radius-md"]).toBeDefined();
  });

  it("maps a live Grackle token onto its MCP-standard name", () => {
    document.documentElement.style.setProperty("--bg-base", "rgb(1, 2, 3)");
    document.documentElement.style.setProperty("--text-primary", "rgb(4, 5, 6)");
    const vars = grackleHostStyleVariables();
    expect(vars["--color-background-primary"]).toBe("rgb(1, 2, 3)");
    expect(vars["--color-text-primary"]).toBe("rgb(4, 5, 6)");
  });
});
