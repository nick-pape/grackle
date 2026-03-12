import { describe, it, expect } from "vitest";

describe("cli", () => {
  it("imports task commands", async () => {
    const mod = await import("./commands/task.js");
    expect(typeof mod.registerTaskCommands).toBe("function");
  });
});
