/**
 * Unit tests for {@link reconnectOrProvision}.
 */
import { describe, it, expect, vi } from "vitest";
import type { EnvironmentAdapter, ProvisionEvent } from "./adapter.js";
import { reconnectOrProvision } from "./adapter.js";

/** Collect all events from an async generator. */
async function collect(gen: AsyncGenerator<ProvisionEvent>): Promise<ProvisionEvent[]> {
  const events: ProvisionEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Create a minimal mock adapter with provision and optional reconnect. */
function createMockAdapter(overrides?: Partial<EnvironmentAdapter>): EnvironmentAdapter {
  return {
    type: "test",
    provision: vi.fn(async function* () {
      yield { stage: "provision", message: "Provisioning", progress: 1 };
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
    healthCheck: vi.fn(),
    reconnect: vi.fn(async function* () {
      yield { stage: "reconnect", message: "Reconnecting", progress: 1 };
    }),
    ...overrides,
  };
}

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe("reconnectOrProvision", () => {
  it("uses reconnect when bootstrapped and force is false", async () => {
    const adapter = createMockAdapter();
    const events = await collect(
      reconnectOrProvision("env-1", adapter, {}, "token", true, silentLogger, false),
    );

    expect(adapter.reconnect).toHaveBeenCalledOnce();
    expect(adapter.provision).not.toHaveBeenCalled();
    expect(events[0].stage).toBe("reconnect");
  });

  it("skips reconnect and uses provision when force is true", async () => {
    const adapter = createMockAdapter();
    const events = await collect(
      reconnectOrProvision("env-1", adapter, {}, "token", true, silentLogger, true),
    );

    expect(adapter.reconnect).not.toHaveBeenCalled();
    expect(adapter.provision).toHaveBeenCalledOnce();
    expect(events[0].stage).toBe("provision");
  });

  it("uses provision when not bootstrapped (force omitted)", async () => {
    const adapter = createMockAdapter();
    const events = await collect(
      reconnectOrProvision("env-1", adapter, {}, "token", false, silentLogger),
    );

    expect(adapter.reconnect).not.toHaveBeenCalled();
    expect(adapter.provision).toHaveBeenCalledOnce();
    expect(events[0].stage).toBe("provision");
  });

  it("falls back to provision when reconnect throws", async () => {
    const adapter = createMockAdapter({
      reconnect: vi.fn(async function* () {
        throw new Error("reconnect failed");
      }),
    });
    const events = await collect(
      reconnectOrProvision("env-1", adapter, {}, "token", true, silentLogger, false),
    );

    expect(adapter.reconnect).toHaveBeenCalledOnce();
    expect(adapter.provision).toHaveBeenCalledOnce();
    expect(events[0].stage).toBe("provision");
  });

  it("defaults force to false when omitted", async () => {
    const adapter = createMockAdapter();
    const events = await collect(
      reconnectOrProvision("env-1", adapter, {}, "token", true, silentLogger),
    );

    expect(adapter.reconnect).toHaveBeenCalledOnce();
    expect(events[0].stage).toBe("reconnect");
  });
});
