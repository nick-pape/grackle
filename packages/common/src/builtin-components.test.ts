import { describe, it, expect } from "vitest";
import { z } from "zod";
import { BUILTIN_COMPONENTS, BUILTIN_COMPONENT_JSON_SCHEMAS } from "./builtin-components.js";
import { BUILTIN_COMPONENT_SCHEMAS } from "./builtin-component-schemas.js";

/** Minimal shape of a JSON Schema object for the assertions below. */
interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, { type?: string; enum?: unknown[] }>;
  required?: string[];
}

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

  it("the catalog matches the zod schema source of truth (name-for-name)", () => {
    expect(BUILTIN_COMPONENTS.map((c) => c.name).sort()).toEqual(
      Object.keys(BUILTIN_COMPONENT_SCHEMAS).sort(),
    );
  });

  it("derives correct JSON Schema from the zod schemas (enums, required, integers)", () => {
    const button = BUILTIN_COMPONENT_JSON_SCHEMAS.Button as JsonSchemaObject;
    expect(button.properties?.variant.enum).toEqual(["primary", "danger", "outline", "ghost"]);
    expect(button.properties?.size.enum).toEqual(["sm", "md", "lg"]);

    // Required string props come through as `required` (text is mandatory).
    const tooltip = BUILTIN_COMPONENT_JSON_SCHEMAS.Tooltip as JsonSchemaObject;
    expect(tooltip.required).toContain("text");
    const copyButton = BUILTIN_COMPONENT_JSON_SCHEMAS.CopyButton as JsonSchemaObject;
    expect(copyButton.required).toContain("text");

    // `z.int()` becomes JSON Schema integer.
    const skeletonText = BUILTIN_COMPONENT_JSON_SCHEMAS.SkeletonText as JsonSchemaObject;
    expect(skeletonText.properties?.lines.type).toBe("integer");
  });

  it("every derived JSON Schema round-trips back through zod (parses as a schema)", () => {
    // The render path turns a stored propsSchema string back into a validator via
    // z.fromJSONSchema; assert our generated schemas are valid input for it.
    for (const c of BUILTIN_COMPONENTS) {
      const json = JSON.parse(c.propsSchema) as Parameters<typeof z.fromJSONSchema>[0];
      expect(() => z.fromJSONSchema(json), `${c.name} round-trip`).not.toThrow();
    }
  });
});
