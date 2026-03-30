import { describe, it, expect, vi } from "vitest";
import { loadPlugins } from "./loader.js";
import type { GracklePlugin } from "./plugin.js";
import type { PluginContext, Disposable } from "./context.js";
import type { Logger } from "pino";

/** Create a minimal mock PluginContext for testing. */
function createMockContext(): PluginContext {
  return {
    subscribe: vi.fn(() => vi.fn()),
    emit: vi.fn() as PluginContext["emit"],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger,
    config: {
      grpcPort: 7434,
      webPort: 3000,
      mcpPort: 7435,
      powerlinePort: 7433,
      host: "127.0.0.1",
      grackleHome: "/tmp/grackle",
      apiKey: "test-key",
    },
  };
}

/** Create a minimal plugin for testing. */
function createPlugin(overrides: Partial<GracklePlugin> & { name: string }): GracklePlugin {
  return { ...overrides };
}

// ─── Topological Sort ─────────────────────────────────────────

describe("loadPlugins — topological sort", () => {
  it("returns empty LoadedPlugins for an empty plugin list", async () => {
    const result = await loadPlugins([], createMockContext());
    expect(result.serviceRegistrations).toEqual([]);
    expect(result.reconciliationPhases).toEqual([]);
    expect(result.mcpTools).toEqual([]);
    expect(result.subscriberDisposables).toEqual([]);
  });

  it("loads a single plugin with no dependencies", async () => {
    const init = vi.fn();
    const plugin = createPlugin({ name: "alpha", initialize: init });

    await loadPlugins([plugin], createMockContext());

    expect(init).toHaveBeenCalledTimes(1);
  });

  it("loads plugins in dependency order", async () => {
    const order: string[] = [];
    const pluginA = createPlugin({
      name: "a",
      dependencies: ["b"],
      initialize: async () => { order.push("a"); },
    });
    const pluginB = createPlugin({
      name: "b",
      initialize: async () => { order.push("b"); },
    });

    await loadPlugins([pluginA, pluginB], createMockContext());

    expect(order).toEqual(["b", "a"]);
  });

  it("handles diamond dependencies correctly", async () => {
    const order: string[] = [];
    const make = (name: string, deps?: string[]): GracklePlugin => createPlugin({
      name,
      dependencies: deps,
      initialize: async () => { order.push(name); },
    });

    // A depends on B and C; both B and C depend on D
    const plugins = [make("a", ["b", "c"]), make("b", ["d"]), make("c", ["d"]), make("d")];

    await loadPlugins(plugins, createMockContext());

    // D must be first, A must be last. B and C can be in either order.
    expect(order[0]).toBe("d");
    expect(order[3]).toBe("a");
    expect(new Set(order.slice(1, 3))).toEqual(new Set(["b", "c"]));
  });

  it("throws on dependency cycle", async () => {
    const pluginA = createPlugin({ name: "a", dependencies: ["b"] });
    const pluginB = createPlugin({ name: "b", dependencies: ["a"] });

    await expect(loadPlugins([pluginA, pluginB], createMockContext()))
      .rejects.toThrow(/cycle/i);
  });

  it("throws on missing dependency", async () => {
    const plugin = createPlugin({ name: "a", dependencies: ["nonexistent"] });

    await expect(loadPlugins([plugin], createMockContext()))
      .rejects.toThrow(/nonexistent/i);
  });

  it("throws on duplicate plugin names", async () => {
    const pluginA = createPlugin({ name: "dup" });
    const pluginB = createPlugin({ name: "dup" });

    await expect(loadPlugins([pluginA, pluginB], createMockContext()))
      .rejects.toThrow(/duplicate/i);
  });
});

// ─── Contribution Collection ──────────────────────────────────

describe("loadPlugins — contribution collection", () => {
  it("collects gRPC handler registrations", async () => {
    const fakeService = { typeName: "FakeService" } as GracklePlugin extends never ? never : Parameters<NonNullable<GracklePlugin["grpcHandlers"]>>[0] extends never ? never : unknown;
    const registration = { service: fakeService, handlers: { list: vi.fn() } };
    const plugin = createPlugin({
      name: "test",
      grpcHandlers: () => [registration as never],
    });

    const result = await loadPlugins([plugin], createMockContext());

    expect(result.serviceRegistrations).toHaveLength(1);
    expect(result.serviceRegistrations[0]).toBe(registration);
  });

  it("collects reconciliation phases", async () => {
    const phase = { name: "test-phase", execute: vi.fn() };
    const plugin = createPlugin({
      name: "test",
      reconciliationPhases: () => [phase],
    });

    const result = await loadPlugins([plugin], createMockContext());

    expect(result.reconciliationPhases).toEqual([phase]);
  });

  it("collects MCP tools", async () => {
    const tool = { name: "test_tool", group: "test", description: "A test tool" };
    const plugin = createPlugin({
      name: "test",
      mcpTools: () => [tool as never],
    });

    const result = await loadPlugins([plugin], createMockContext());

    expect(result.mcpTools).toHaveLength(1);
    expect(result.mcpTools[0]).toBe(tool);
  });

  it("collects event subscriber disposables", async () => {
    const disposable: Disposable = { dispose: vi.fn() };
    const plugin = createPlugin({
      name: "test",
      eventSubscribers: () => [disposable],
    });

    const result = await loadPlugins([plugin], createMockContext());

    expect(result.subscriberDisposables).toEqual([disposable]);
  });

  it("merges contributions from multiple plugins in load order", async () => {
    const phaseA = { name: "phase-a", execute: vi.fn() };
    const phaseB = { name: "phase-b", execute: vi.fn() };
    const pluginA = createPlugin({
      name: "a",
      dependencies: ["b"],
      reconciliationPhases: () => [phaseA],
    });
    const pluginB = createPlugin({
      name: "b",
      reconciliationPhases: () => [phaseB],
    });

    const result = await loadPlugins([pluginA, pluginB], createMockContext());

    // B loads first (dependency), so its phases come first
    expect(result.reconciliationPhases).toEqual([phaseB, phaseA]);
  });

  it("handles plugins with no contributions", async () => {
    const init = vi.fn();
    const plugin = createPlugin({ name: "empty", initialize: init });

    const result = await loadPlugins([plugin], createMockContext());

    expect(init).toHaveBeenCalled();
    expect(result.serviceRegistrations).toEqual([]);
    expect(result.reconciliationPhases).toEqual([]);
    expect(result.mcpTools).toEqual([]);
    expect(result.subscriberDisposables).toEqual([]);
  });

  it("handles plugins with only some contributions", async () => {
    const phase = { name: "only-phase", execute: vi.fn() };
    const plugin = createPlugin({
      name: "partial",
      reconciliationPhases: () => [phase],
      // No grpcHandlers, mcpTools, or eventSubscribers
    });

    const result = await loadPlugins([plugin], createMockContext());

    expect(result.reconciliationPhases).toEqual([phase]);
    expect(result.serviceRegistrations).toEqual([]);
    expect(result.mcpTools).toEqual([]);
    expect(result.subscriberDisposables).toEqual([]);
  });
});

// ─── Lifecycle ────────────────────────────────────────────────

describe("loadPlugins — lifecycle", () => {
  it("calls initialize() in dependency order", async () => {
    const order: string[] = [];
    const pluginA = createPlugin({
      name: "a",
      dependencies: ["b"],
      initialize: async () => { order.push("a"); },
    });
    const pluginB = createPlugin({
      name: "b",
      initialize: async () => { order.push("b"); },
    });

    await loadPlugins([pluginA, pluginB], createMockContext());

    expect(order).toEqual(["b", "a"]);
  });

  it("skips initialize() for plugins that don't define it", async () => {
    const plugin = createPlugin({ name: "no-init" });

    // Should not throw
    const result = await loadPlugins([plugin], createMockContext());
    expect(result).toBeDefined();
  });

  it("rejects if initialize() throws, without initializing dependents", async () => {
    const initB = vi.fn();
    const pluginA = createPlugin({
      name: "a",
      initialize: async () => { throw new Error("init failed"); },
    });
    const pluginB = createPlugin({
      name: "b",
      dependencies: ["a"],
      initialize: initB,
    });

    await expect(loadPlugins([pluginA, pluginB], createMockContext()))
      .rejects.toThrow("init failed");
    expect(initB).not.toHaveBeenCalled();
  });

  it("shutdown() calls plugin shutdown in reverse order", async () => {
    const order: string[] = [];
    const pluginA = createPlugin({
      name: "a",
      dependencies: ["b"],
      shutdown: async () => { order.push("a"); },
    });
    const pluginB = createPlugin({
      name: "b",
      shutdown: async () => { order.push("b"); },
    });

    const result = await loadPlugins([pluginA, pluginB], createMockContext());
    await result.shutdown();

    expect(order).toEqual(["a", "b"]);
  });

  it("shutdown() disposes all subscriber disposables", async () => {
    const dispose = vi.fn();
    const plugin = createPlugin({
      name: "test",
      eventSubscribers: () => [{ dispose }],
    });

    const result = await loadPlugins([plugin], createMockContext());
    await result.shutdown();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("shutdown() continues even if one plugin throws", async () => {
    const shutdownB = vi.fn();
    const pluginA = createPlugin({
      name: "a",
      dependencies: ["b"],
      shutdown: async () => { throw new Error("shutdown failed"); },
    });
    const pluginB = createPlugin({
      name: "b",
      shutdown: shutdownB,
    });

    const result = await loadPlugins([pluginA, pluginB], createMockContext());
    // Should not throw — errors are caught
    await result.shutdown();

    // B's shutdown still called despite A's failure
    expect(shutdownB).toHaveBeenCalledTimes(1);
  });
});
