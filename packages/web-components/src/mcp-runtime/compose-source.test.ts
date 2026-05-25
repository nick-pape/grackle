import { describe, it, expect } from "vitest";
import { composeSource } from "./compose-source.js";

describe("composeSource (#1270 composition)", () => {
  it("returns the source unchanged when there are no dependencies", () => {
    expect(composeSource("render(<Button/>)", [])).toBe("render(<Button/>)");
  });

  it("prepends each dependency as a local component definition before the root", () => {
    const out = composeSource("render(<Child label='Hi'/>)", [
      { name: "Child", body: "render(<Button>{props.label}</Button>)" },
    ]);
    // Child is defined as a (props) => element with a local render capture, then the root runs.
    expect(out).toContain("const Child = (props) =>");
    expect(out).toContain("render(<Button>{props.label}</Button>)");
    // The dependency definition comes before the root body.
    expect(out.indexOf("const Child")).toBeLessThan(out.indexOf("render(<Child label='Hi'/>)"));
  });

  it("emits dependencies in the given (topo/deepest-first) order", () => {
    const out = composeSource("render(<A/>)", [
      { name: "C", body: "render(<span/>)" },
      { name: "B", body: "render(<C/>)" },
      { name: "A", body: "render(<B/>)" },
    ]);
    expect(out.indexOf("const C")).toBeLessThan(out.indexOf("const B"));
    expect(out.indexOf("const B")).toBeLessThan(out.indexOf("const A"));
  });
});
