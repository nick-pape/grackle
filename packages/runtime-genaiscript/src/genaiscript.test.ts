import { describe, it, expect } from "vitest";
import { GenAIScriptRuntime } from "./genaiscript.js";

describe("GenAIScriptRuntime", () => {
  it("has the correct runtime name", () => {
    const runtime = new GenAIScriptRuntime();
    expect(runtime.name).toBe("genaiscript");
  });
});
