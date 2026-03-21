import { describe, it, expect } from "vitest";

describe("@grackle-ai/knowledge", () => {
  it("should export the expected public API", async () => {
    const mod = await import("./index.js");
    expect(mod.createLocalEmbedder).toBeTypeOf("function");
  });
});
