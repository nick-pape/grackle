import { describe, it, expect } from "vitest";
import { extractComponentReferenceNames } from "./component-refs.js";

describe("extractComponentReferenceNames", () => {
  it("finds capitalized JSX tags (open + self-closing)", () => {
    const src = "render(<Dashboard><RevenueChart period='Q1'/><Spinner/></Dashboard>)";
    expect(extractComponentReferenceNames(src)).toEqual(["Dashboard", "RevenueChart", "Spinner"]);
  });

  it("ignores lowercase/HTML tags", () => {
    expect(extractComponentReferenceNames("render(<div><span/><Card/></div>)")).toEqual(["Card"]);
  });

  it("dedupes repeated references, first-seen order", () => {
    expect(extractComponentReferenceNames("<A/><B/><A/>")).toEqual(["A", "B"]);
  });

  it("tolerates whitespace after '<' and underscores/digits in names", () => {
    expect(extractComponentReferenceNames("< Foo_2 /> < bar/>")).toEqual(["Foo_2"]);
  });

  it("returns [] when there are no component tags", () => {
    expect(extractComponentReferenceNames("render(<div>hello</div>)")).toEqual([]);
    expect(extractComponentReferenceNames("")).toEqual([]);
  });
});
