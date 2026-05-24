import { describe, it, expect } from "vitest";
import { BUILTIN_COMPONENTS } from "./builtin-components.js";

describe("BUILTIN_COMPONENTS", () => {
  it("has a non-empty catalog", () => {
    expect(BUILTIN_COMPONENTS.length).toBeGreaterThan(0);
  });

  it("each entry is well-formed with a JSON-Schema-shaped propsSchema", () => {
    for (const c of BUILTIN_COMPONENTS) {
      expect(c.name, "name").toBeTruthy();
      expect(c.description.length, `${c.name} description`).toBeGreaterThan(0);
      expect(c.example.length, `${c.name} example`).toBeGreaterThan(0);
      const schema = JSON.parse(c.propsSchema) as Record<string, unknown>;
      expect(typeof schema, `${c.name} propsSchema is an object`).toBe("object");
      expect(schema, `${c.name} propsSchema non-null`).not.toBeNull();
      // Looks like a JSON Schema (has a type or properties).
      expect(schema.type ?? schema.properties, `${c.name} propsSchema shape`).toBeDefined();
    }
  });

  it("has unique component names", () => {
    const names = BUILTIN_COMPONENTS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
