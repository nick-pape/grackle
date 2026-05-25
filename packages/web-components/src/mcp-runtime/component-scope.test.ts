import { describe, it, expect } from "vitest";
import { CURATED_COMPONENT_NAMES } from "./component-scope.js";
import { BUILTIN_COMPONENTS } from "@grackle-ai/common";

describe("built-in component catalog vs runtime scope (drift guard)", () => {
  it("every catalog entry names a component the runtime actually provides", () => {
    const scope = new Set(CURATED_COMPONENT_NAMES);
    for (const c of BUILTIN_COMPONENTS) {
      expect(scope.has(c.name), `BUILTIN_COMPONENTS advertises "${c.name}" but the runtime scope does not provide it`).toBe(true);
    }
  });
});
