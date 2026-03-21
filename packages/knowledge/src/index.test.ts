import { describe, it, expect } from "vitest";

describe("@grackle-ai/knowledge", () => {
  it("should be importable", async () => {
    const mod = await import("./index.js");
    expect(mod).toBeDefined();
  });
});
