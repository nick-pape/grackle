// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { grackleHostStyleVariables } from "./grackleHostStyleVariables.js";

describe("grackleHostStyleVariables", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("style");
  });

  it("always returns the MCP-standard fallback variables", () => {
    const vars = grackleHostStyleVariables();
    expect(vars["--color-background-primary"]).toBe("light-dark(#ffffff, #1a1a1a)");
    expect(vars["--color-text-primary"]).toBe("light-dark(#1f2937, #f3f4f6)");
    expect(vars["--font-sans"]).toBe(
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    );
    expect(vars["--border-radius-md"]).toBe("6px");
  });

  it("maps a live Grackle token onto its MCP-standard name", () => {
    document.documentElement.style.setProperty("--bg-base", "rgb(1, 2, 3)");
    document.documentElement.style.setProperty("--text-primary", "rgb(4, 5, 6)");
    const vars = grackleHostStyleVariables();
    expect(vars["--color-background-primary"]).toBe("rgb(1, 2, 3)");
    expect(vars["--color-text-primary"]).toBe("rgb(4, 5, 6)");
  });
});
