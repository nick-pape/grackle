import { describe, it, expect } from "vitest";
import { GenAIScriptRuntime } from "./genaiscript.js";

describe("GenAIScriptRuntime", () => {
  it("has the correct runtime name", () => {
    const runtime = new GenAIScriptRuntime();
    expect(runtime.name).toBe("genaiscript");
  });

  it("declares supportsResume: false", () => {
    const runtime = new GenAIScriptRuntime();
    expect(runtime.capabilities.supportsResume).toBe(false);
  });

  it("declares supportsHooks: false", () => {
    const runtime = new GenAIScriptRuntime();
    expect(runtime.capabilities.supportsHooks).toBe(false);
  });

  it("resume() throws an error", () => {
    const runtime = new GenAIScriptRuntime();
    expect(() => runtime.resume({ sessionId: "s1", runtimeSessionId: "rt" })).toThrow(
      "GenAIScript sessions cannot be resumed",
    );
  });
});
