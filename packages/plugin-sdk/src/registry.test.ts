import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerPlugin,
  getRegisteredPlugins,
  getRegistration,
  resolveEnabledPlugins,
  clearRegistry,
} from "./registry.js";
import type { PluginRegistration } from "./registry.js";
import type { GracklePlugin } from "./plugin.js";

/** Create a minimal PluginRegistration for testing. */
function createRegistration(
  overrides: Partial<PluginRegistration> & { name: string },
): PluginRegistration {
  return {
    description: `Test plugin: ${overrides.name}`,
    required: false,
    defaultEnabled: true,
    create: () => ({ name: overrides.name }),
    ...overrides,
  };
}

beforeEach(() => {
  clearRegistry();
});

// ─── registerPlugin ──────────────────────────────────────────

describe("registerPlugin", () => {
  it("stores a registration that can be retrieved", () => {
    const reg = createRegistration({ name: "alpha" });
    registerPlugin(reg);

    expect(getRegistration("alpha")).toBe(reg);
  });

  it("throws on duplicate name", () => {
    registerPlugin(createRegistration({ name: "dup" }));

    expect(() => registerPlugin(createRegistration({ name: "dup" }))).toThrow(
      /already registered/i,
    );
  });

  it("allows registering multiple plugins with different names", () => {
    registerPlugin(createRegistration({ name: "a" }));
    registerPlugin(createRegistration({ name: "b" }));

    expect(getRegisteredPlugins()).toHaveLength(2);
  });
});

// ─── getRegisteredPlugins ────────────────────────────────────

describe("getRegisteredPlugins", () => {
  it("returns empty array when no plugins registered", () => {
    expect(getRegisteredPlugins()).toEqual([]);
  });

  it("returns plugins in insertion order", () => {
    registerPlugin(createRegistration({ name: "first" }));
    registerPlugin(createRegistration({ name: "second" }));
    registerPlugin(createRegistration({ name: "third" }));

    const names = getRegisteredPlugins().map((p) => p.name);
    expect(names).toEqual(["first", "second", "third"]);
  });

  it("returns a snapshot (mutations do not affect registry)", () => {
    registerPlugin(createRegistration({ name: "stable" }));

    const snapshot = getRegisteredPlugins() as PluginRegistration[];
    const lengthBefore = snapshot.length;

    registerPlugin(createRegistration({ name: "later" }));

    expect(snapshot).toHaveLength(lengthBefore);
    expect(getRegisteredPlugins()).toHaveLength(lengthBefore + 1);
  });
});

// ─── getRegistration ─────────────────────────────────────────

describe("getRegistration", () => {
  it("returns undefined for unknown name", () => {
    expect(getRegistration("nonexistent")).toBeUndefined();
  });

  it("returns the correct registration", () => {
    const reg = createRegistration({ name: "target" });
    registerPlugin(createRegistration({ name: "other" }));
    registerPlugin(reg);

    expect(getRegistration("target")).toBe(reg);
  });
});

// ─── resolveEnabledPlugins ───────────────────────────────────

describe("resolveEnabledPlugins", () => {
  it("includes required plugins regardless of DB state", () => {
    const create = vi.fn<[], GracklePlugin>(() => ({ name: "core" }));
    registerPlugin(createRegistration({ name: "core", required: true, create }));

    const plugins = resolveEnabledPlugins(() => false);

    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("core");
    expect(create).toHaveBeenCalledOnce();
  });

  it("excludes optional plugins when DB says disabled", () => {
    const create = vi.fn<[], GracklePlugin>(() => ({ name: "optional" }));
    registerPlugin(createRegistration({ name: "optional", required: false, create }));

    const plugins = resolveEnabledPlugins(() => false);

    expect(plugins).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("includes optional plugins when DB says enabled", () => {
    registerPlugin(createRegistration({ name: "optional", required: false }));

    const plugins = resolveEnabledPlugins(() => true);

    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("optional");
  });

  it("falls back to defaultEnabled when DB returns undefined", () => {
    registerPlugin(
      createRegistration({ name: "default-on", required: false, defaultEnabled: true }),
    );
    registerPlugin(
      createRegistration({ name: "default-off", required: false, defaultEnabled: false }),
    );

    const plugins = resolveEnabledPlugins(() => undefined);

    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("default-on");
  });

  it("calls create() only for enabled plugins", () => {
    const createEnabled = vi.fn<[], GracklePlugin>(() => ({ name: "enabled" }));
    const createDisabled = vi.fn<[], GracklePlugin>(() => ({ name: "disabled" }));

    registerPlugin(createRegistration({ name: "enabled", create: createEnabled }));
    registerPlugin(createRegistration({ name: "disabled", create: createDisabled }));

    const getEnabled = (name: string): boolean | undefined => (name === "enabled" ? true : false);
    resolveEnabledPlugins(getEnabled);

    expect(createEnabled).toHaveBeenCalledOnce();
    expect(createDisabled).not.toHaveBeenCalled();
  });

  it("returns plugins in registration order", () => {
    registerPlugin(createRegistration({ name: "a" }));
    registerPlugin(createRegistration({ name: "b" }));
    registerPlugin(createRegistration({ name: "c" }));

    const plugins = resolveEnabledPlugins(() => true);

    expect(plugins.map((p) => p.name)).toEqual(["a", "b", "c"]);
  });

  it("handles empty registry", () => {
    const plugins = resolveEnabledPlugins(() => true);
    expect(plugins).toEqual([]);
  });
});

// ─── clearRegistry ───────────────────────────────────────────

describe("clearRegistry", () => {
  it("removes all registrations", () => {
    registerPlugin(createRegistration({ name: "a" }));
    registerPlugin(createRegistration({ name: "b" }));

    clearRegistry();

    expect(getRegisteredPlugins()).toEqual([]);
    expect(getRegistration("a")).toBeUndefined();
  });

  it("allows re-registration after clear", () => {
    registerPlugin(createRegistration({ name: "a" }));
    clearRegistry();

    expect(() => registerPlugin(createRegistration({ name: "a" }))).not.toThrow();
    expect(getRegisteredPlugins()).toHaveLength(1);
  });
});
