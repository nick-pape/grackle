import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerPlugin, resolveEnabledPlugins, clearRegistry } from "./registry.js";
import { loadPlugins } from "./loader.js";
import type { PluginRegistration } from "./registry.js";
import type { GracklePlugin, ReconciliationPhase } from "./plugin.js";
import type { PluginContext, Disposable } from "./context.js";
import type { DescService } from "@bufbuild/protobuf";
import type { Logger } from "pino";

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

const fakeServiceA = { typeName: "CoreService" } as unknown as DescService;
const fakeServiceB = { typeName: "OrchService" } as unknown as DescService;

beforeEach(() => {
  clearRegistry();
});

describe("registry → resolve → load integration", () => {
  it("registers, resolves enabled plugins, and loads them with contributions", async () => {
    const initOrder: string[] = [];

    registerPlugin({
      name: "core",
      description: "Core",
      required: true,
      defaultEnabled: true,
      create: (): GracklePlugin => ({
        name: "core",
        initialize: async () => {
          initOrder.push("core");
        },
        grpcHandlers: () => [{ service: fakeServiceA, handlers: { listItems: vi.fn() } }],
        reconciliationPhases: () => [{ name: "dispatch", execute: vi.fn() } as ReconciliationPhase],
      }),
    });

    registerPlugin({
      name: "orchestration",
      description: "Orchestration",
      required: false,
      defaultEnabled: true,
      dependencies: ["core"],
      create: (): GracklePlugin => ({
        name: "orchestration",
        dependencies: ["core"],
        initialize: async () => {
          initOrder.push("orchestration");
        },
        grpcHandlers: () => [{ service: fakeServiceB, handlers: { createTask: vi.fn() } }],
      }),
    } as PluginRegistration & { dependencies: string[] });

    registerPlugin({
      name: "disabled-plugin",
      description: "Disabled",
      required: false,
      defaultEnabled: false,
      create: (): GracklePlugin => ({
        name: "disabled-plugin",
        initialize: async () => {
          initOrder.push("disabled-plugin");
        },
      }),
    });

    const getPluginEnabled = (name: string): boolean | undefined => {
      if (name === "orchestration") {
        return true;
      }
      return undefined;
    };

    const plugins = resolveEnabledPlugins(getPluginEnabled);

    expect(plugins.map((p) => p.name)).toEqual(["core", "orchestration"]);

    const loaded = await loadPlugins(plugins, createMockContext());

    expect(loaded.pluginNames).toEqual(["core", "orchestration"]);
    expect(initOrder).toEqual(["core", "orchestration"]);
    expect(loaded.serviceRegistrations).toHaveLength(2);
    expect(loaded.reconciliationPhases).toHaveLength(1);
    expect(loaded.reconciliationPhases[0].name).toBe("dispatch");
  });

  it("required plugins are included even when DB says disabled", async () => {
    registerPlugin({
      name: "core",
      description: "Core",
      required: true,
      defaultEnabled: true,
      create: (): GracklePlugin => ({ name: "core" }),
    });

    const plugins = resolveEnabledPlugins(() => false);

    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("core");
  });

  it("shutdown runs in reverse initialization order", async () => {
    const shutdownOrder: string[] = [];

    registerPlugin({
      name: "base",
      description: "Base",
      required: true,
      defaultEnabled: true,
      create: (): GracklePlugin => ({
        name: "base",
        shutdown: async () => {
          shutdownOrder.push("base");
        },
      }),
    });

    registerPlugin({
      name: "dependent",
      description: "Dependent",
      required: false,
      defaultEnabled: true,
      create: (): GracklePlugin => ({
        name: "dependent",
        dependencies: ["base"],
        shutdown: async () => {
          shutdownOrder.push("dependent");
        },
      }),
    });

    const plugins = resolveEnabledPlugins(() => true);
    const loaded = await loadPlugins(plugins, createMockContext());
    await loaded.shutdown();

    expect(shutdownOrder).toEqual(["dependent", "base"]);
  });

  it("event subscribers are collected and disposed on shutdown", async () => {
    const dispose = vi.fn();

    registerPlugin({
      name: "with-subscriber",
      description: "Has subscriber",
      required: true,
      defaultEnabled: true,
      create: (): GracklePlugin => ({
        name: "with-subscriber",
        eventSubscribers: (): Disposable[] => [{ dispose }],
      }),
    });

    const plugins = resolveEnabledPlugins(() => undefined);
    const loaded = await loadPlugins(plugins, createMockContext());

    expect(loaded.subscriberDisposables).toHaveLength(1);

    await loaded.shutdown();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
