import { describe, it, expect, vi } from "vitest";
import { createServiceCollector } from "./service-collector.js";
import type { ConnectRouter } from "@connectrpc/connect";

// Fake service definitions — just unique objects for Map key identity.
const serviceA = { typeName: "ServiceA" } as unknown as Parameters<ConnectRouter["service"]>[0];
const serviceB = { typeName: "ServiceB" } as unknown as Parameters<ConnectRouter["service"]>[0];

describe("createServiceCollector", () => {
  it("returns empty handlers for an unknown service", () => {
    const collector = createServiceCollector();
    expect(collector.getHandlers(serviceA)).toEqual({});
  });

  it("collects a single handler group", () => {
    const collector = createServiceCollector();
    const handler = vi.fn();
    collector.addHandlers(serviceA, { listItems: handler });

    const handlers = collector.getHandlers(serviceA);
    expect(handlers).toEqual({ listItems: handler });
  });

  it("merges multiple handler groups for the same service", () => {
    const collector = createServiceCollector();
    const listItems = vi.fn();
    const createItem = vi.fn();
    const deleteItem = vi.fn();

    collector.addHandlers(serviceA, { listItems });
    collector.addHandlers(serviceA, { createItem, deleteItem });

    const handlers = collector.getHandlers(serviceA);
    expect(handlers).toEqual({ listItems, createItem, deleteItem });
  });

  it("keeps services isolated from each other", () => {
    const collector = createServiceCollector();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    collector.addHandlers(serviceA, { foo: handlerA });
    collector.addHandlers(serviceB, { bar: handlerB });

    expect(collector.getHandlers(serviceA)).toEqual({ foo: handlerA });
    expect(collector.getHandlers(serviceB)).toEqual({ bar: handlerB });
  });

  it("later handler group overwrites earlier handler with same name (last-write-wins)", () => {
    const collector = createServiceCollector();
    const original = vi.fn();
    const replacement = vi.fn();

    collector.addHandlers(serviceA, { doThing: original });
    collector.addHandlers(serviceA, { doThing: replacement });

    expect(collector.getHandlers(serviceA).doThing).toBe(replacement);
  });

  it("buildRoutes calls router.service() with merged handlers", () => {
    const collector = createServiceCollector();
    const listItems = vi.fn();
    const createItem = vi.fn();

    collector.addHandlers(serviceA, { listItems });
    collector.addHandlers(serviceA, { createItem });

    const mockRouter = { service: vi.fn() } as unknown as ConnectRouter;
    const routes = collector.buildRoutes();
    routes(mockRouter);

    expect(mockRouter.service).toHaveBeenCalledTimes(1);
    expect(mockRouter.service).toHaveBeenCalledWith(serviceA, { listItems, createItem });
  });

  it("buildRoutes registers each service separately", () => {
    const collector = createServiceCollector();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    collector.addHandlers(serviceA, { foo: handlerA });
    collector.addHandlers(serviceB, { bar: handlerB });

    const mockRouter = { service: vi.fn() } as unknown as ConnectRouter;
    const routes = collector.buildRoutes();
    routes(mockRouter);

    expect(mockRouter.service).toHaveBeenCalledTimes(2);
    expect(mockRouter.service).toHaveBeenCalledWith(serviceA, { foo: handlerA });
    expect(mockRouter.service).toHaveBeenCalledWith(serviceB, { bar: handlerB });
  });
});
