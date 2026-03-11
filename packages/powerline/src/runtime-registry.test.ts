import { describe, it, expect, beforeEach } from "vitest";
import { registerRuntime, getRuntime, listRuntimes } from "./runtime-registry.js";
import type { AgentRuntime } from "./runtimes/runtime.js";

function makeMockRuntime(name: string): AgentRuntime {
  return {
    name,
    spawn: () => {
      throw new Error("not implemented");
    },
    resume: () => {
      throw new Error("not implemented");
    },
  };
}

describe("runtime-registry", () => {
  beforeEach(() => {
    // Clean up by re-registering known test runtimes won't help since there's
    // no "unregister". The module is a singleton with no clear function.
    // Tests use unique names to avoid collisions.
  });

  it("register/get/list roundtrip", () => {
    const rt = makeMockRuntime("test-rt-1");
    registerRuntime(rt);

    expect(getRuntime("test-rt-1")).toBe(rt);
    expect(listRuntimes()).toContain("test-rt-1");
  });

  it("getRuntime returns undefined for unknown name", () => {
    expect(getRuntime("nonexistent-runtime")).toBeUndefined();
  });

  it("duplicate name overwrites the previous runtime", () => {
    const rt1 = makeMockRuntime("test-rt-dup");
    const rt2 = makeMockRuntime("test-rt-dup");

    registerRuntime(rt1);
    registerRuntime(rt2);

    expect(getRuntime("test-rt-dup")).toBe(rt2);
  });
});
