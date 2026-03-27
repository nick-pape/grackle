import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { extractText } from "./EventRenderer.js";

describe("extractText", () => {
  it("extracts plain string", () => {
    expect(extractText("hello")).toBe("hello");
  });

  it("extracts number", () => {
    expect(extractText(42)).toBe("42");
  });

  it("returns empty string for null/undefined", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
  });

  it("concatenates array children", () => {
    expect(extractText(["hello", " ", "world"])).toBe("hello world");
  });

  it("extracts text from nested React elements", () => {
    // Simulates: <span><span>function</span> <span>fibonacci</span></span>
    const inner = createElement("span", null, "function");
    const inner2 = createElement("span", null, "fibonacci");
    const outer = createElement("span", null, inner, " ", inner2);
    expect(extractText(outer)).toBe("function fibonacci");
  });

  it("handles deeply nested prism-like token structure", () => {
    // Simulates rehype-prism-plus output: <code><span class="token keyword">const</span> x = <span class="token number">42</span>;</code>
    const keyword = createElement("span", { className: "token keyword" }, "const");
    const num = createElement("span", { className: "token number" }, "42");
    const code = createElement("code", null, keyword, " x = ", num, ";");
    expect(extractText(code)).toBe("const x = 42;");
  });

  it("handles mixed arrays and elements", () => {
    const span = createElement("span", null, "bold");
    expect(extractText(["text ", span, " more"])).toBe("text bold more");
  });

  it("returns empty string for boolean children", () => {
    expect(extractText(true as unknown as string)).toBe("");
    expect(extractText(false as unknown as string)).toBe("");
  });
});
