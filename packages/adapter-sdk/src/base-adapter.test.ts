import { describe, it, expect, vi } from "vitest";
import type { PowerLineConnection, ProvisionEvent } from "./adapter.js";
import { BaseAdapter } from "./base-adapter.js";

/** Collect all events from an async generator. */
async function collect(gen: AsyncGenerator<ProvisionEvent>): Promise<ProvisionEvent[]> {
  const events: ProvisionEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Minimal concrete adapter for testing the BaseAdapter state machine. */
class TestAdapter extends BaseAdapter {
  public type: string = "test";

  public doProvisionFn = vi.fn(async function* (): AsyncGenerator<ProvisionEvent> {
    yield { stage: "done", message: "provisioned", progress: 1 };
  });
  public doConnectFn = vi.fn(
    async (environmentId: string): Promise<PowerLineConnection> =>
      ({
        environmentId,
        port: 7433,
        transport: {},
        ping: vi.fn(),
        close: vi.fn(),
      }) as unknown as PowerLineConnection,
  );
  public doDisconnectFn = vi.fn(async () => {});
  public doStopFn = vi.fn(async () => {});
  public doDestroyFn = vi.fn(async () => {});
  public healthCheckFn = vi.fn(async () => true);

  protected async *doProvision(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent> {
    yield* this.doProvisionFn(environmentId, config, powerlineToken);
  }

  protected async doConnect(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): Promise<PowerLineConnection> {
    return this.doConnectFn(environmentId, config, powerlineToken);
  }

  protected async doDisconnect(environmentId: string): Promise<void> {
    return this.doDisconnectFn(environmentId);
  }

  protected async doStop(environmentId: string, config: Record<string, unknown>): Promise<void> {
    return this.doStopFn(environmentId, config);
  }

  protected async doDestroy(environmentId: string, config: Record<string, unknown>): Promise<void> {
    return this.doDestroyFn(environmentId, config);
  }

  public async healthCheck(connection: PowerLineConnection): Promise<boolean> {
    return this.healthCheckFn(connection);
  }
}

describe("BaseAdapter", () => {
  describe("state transitions", () => {
    it("starts at idle for unknown environments", () => {
      const adapter = new TestAdapter();
      expect(adapter.getState("env-1")).toBe("idle");
    });

    it("transitions idle -> provisioning -> provisioned on provision", async () => {
      const adapter = new TestAdapter();
      await collect(adapter.provision("env-1", {}, "token"));
      expect(adapter.getState("env-1")).toBe("provisioned");
    });

    it("transitions provisioned -> connected on connect", async () => {
      const adapter = new TestAdapter();
      await collect(adapter.provision("env-1", {}, "token"));
      await adapter.connect("env-1", {}, "token");
      expect(adapter.getState("env-1")).toBe("connected");
    });

    it("transitions connected -> idle on disconnect", async () => {
      const adapter = new TestAdapter();
      await collect(adapter.provision("env-1", {}, "token"));
      await adapter.connect("env-1", {}, "token");
      await adapter.disconnect("env-1");
      expect(adapter.getState("env-1")).toBe("idle");
    });

    it("transitions to idle on stop", async () => {
      const adapter = new TestAdapter();
      await collect(adapter.provision("env-1", {}, "token"));
      await adapter.connect("env-1", {}, "token");
      await adapter.stop("env-1", {});
      expect(adapter.getState("env-1")).toBe("idle");
    });

    it("removes state on destroy", async () => {
      const adapter = new TestAdapter();
      await collect(adapter.provision("env-1", {}, "token"));
      await adapter.connect("env-1", {}, "token");
      await adapter.destroy("env-1", {});
      expect(adapter.getState("env-1")).toBe("idle");
    });
  });

  describe("provision error rollback", () => {
    it("resets to idle when provision throws", async () => {
      const adapter = new TestAdapter();
      adapter.doProvisionFn.mockImplementation(async function* () {
        throw new Error("provision failed");
      });

      await expect(collect(adapter.provision("env-1", {}, "token"))).rejects.toThrow(
        "provision failed",
      );
      expect(adapter.getState("env-1")).toBe("idle");
    });
  });

  describe("provision mutex", () => {
    it("throws when provision is called while another provision is in progress", async () => {
      const adapter = new TestAdapter();

      let resolveProvision!: () => void;
      const provisionPromise = new Promise<void>((resolve) => {
        resolveProvision = resolve;
      });

      adapter.doProvisionFn.mockImplementation(async function* () {
        await provisionPromise;
        yield { stage: "done", message: "provisioned", progress: 1 };
      });

      // Start first provision (will block)
      const first = collect(adapter.provision("env-1", {}, "token"));

      // Second provision should throw immediately
      await expect(collect(adapter.provision("env-1", {}, "token"))).rejects.toThrow(
        /Operation already in progress/,
      );

      // Complete first provision
      resolveProvision();
      await first;
      expect(adapter.getState("env-1")).toBe("provisioned");
    });

    it("releases lock after provision error", async () => {
      const adapter = new TestAdapter();

      adapter.doProvisionFn.mockImplementationOnce(async function* () {
        throw new Error("first attempt failed");
      });

      await expect(collect(adapter.provision("env-1", {}, "token"))).rejects.toThrow(
        "first attempt failed",
      );

      // Should be able to provision again after error
      adapter.doProvisionFn.mockImplementation(async function* () {
        yield { stage: "done", message: "provisioned", progress: 1 };
      });

      await collect(adapter.provision("env-1", {}, "token"));
      expect(adapter.getState("env-1")).toBe("provisioned");
    });

    it("allows concurrent provisions on different environments", async () => {
      const adapter = new TestAdapter();

      const [events1, events2] = await Promise.all([
        collect(adapter.provision("env-1", {}, "token")),
        collect(adapter.provision("env-2", {}, "token")),
      ]);

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(adapter.getState("env-1")).toBe("provisioned");
      expect(adapter.getState("env-2")).toBe("provisioned");
    });
  });

  describe("lock prevents concurrent operations during provision", () => {
    function setupBlockingProvision(adapter: TestAdapter): {
      provisionTask: Promise<ProvisionEvent[]>;
      resolve: () => void;
    } {
      let resolveProvision!: () => void;
      const provisionPromise = new Promise<void>((resolve) => {
        resolveProvision = resolve;
      });

      adapter.doProvisionFn.mockImplementation(async function* () {
        await provisionPromise;
        yield { stage: "done", message: "provisioned", progress: 1 };
      });

      const provisionTask = collect(adapter.provision("env-1", {}, "token"));
      return { provisionTask, resolve: resolveProvision };
    }

    it("throws when connect is called during provision", async () => {
      const adapter = new TestAdapter();
      const { provisionTask, resolve } = setupBlockingProvision(adapter);

      await expect(adapter.connect("env-1", {}, "token")).rejects.toThrow(
        /Operation already in progress/,
      );

      resolve();
      await provisionTask;
    });

    it("throws when disconnect is called during provision", async () => {
      const adapter = new TestAdapter();
      const { provisionTask, resolve } = setupBlockingProvision(adapter);

      await expect(adapter.disconnect("env-1")).rejects.toThrow(/Operation already in progress/);

      resolve();
      await provisionTask;
    });

    it("throws when stop is called during provision", async () => {
      const adapter = new TestAdapter();
      const { provisionTask, resolve } = setupBlockingProvision(adapter);

      await expect(adapter.stop("env-1", {})).rejects.toThrow(/Operation already in progress/);

      resolve();
      await provisionTask;
    });

    it("throws when destroy is called during provision", async () => {
      const adapter = new TestAdapter();
      const { provisionTask, resolve } = setupBlockingProvision(adapter);

      await expect(adapter.destroy("env-1", {})).rejects.toThrow(/Operation already in progress/);

      resolve();
      await provisionTask;
    });
  });

  describe("idempotent operations", () => {
    it("disconnect is safe to call when not connected", async () => {
      const adapter = new TestAdapter();
      await adapter.disconnect("env-1");
      expect(adapter.getState("env-1")).toBe("idle");
    });

    it("disconnect is safe to call multiple times", async () => {
      const adapter = new TestAdapter();
      await collect(adapter.provision("env-1", {}, "token"));
      await adapter.connect("env-1", {}, "token");
      await adapter.disconnect("env-1");
      await adapter.disconnect("env-1");
      expect(adapter.getState("env-1")).toBe("idle");
    });

    it("stop is safe to call from idle", async () => {
      const adapter = new TestAdapter();
      await adapter.stop("env-1", {});
      expect(adapter.getState("env-1")).toBe("idle");
    });

    it("stop is safe to call multiple times", async () => {
      const adapter = new TestAdapter();
      await collect(adapter.provision("env-1", {}, "token"));
      await adapter.connect("env-1", {}, "token");
      await adapter.stop("env-1", {});
      await adapter.stop("env-1", {});
      expect(adapter.getState("env-1")).toBe("idle");
    });

    it("destroy is safe to call from idle", async () => {
      const adapter = new TestAdapter();
      await adapter.destroy("env-1", {});
      expect(adapter.getState("env-1")).toBe("idle");
    });

    it("destroy is safe to call multiple times", async () => {
      const adapter = new TestAdapter();
      await collect(adapter.provision("env-1", {}, "token"));
      await adapter.connect("env-1", {}, "token");
      await adapter.destroy("env-1", {});
      await adapter.destroy("env-1", {});
      expect(adapter.getState("env-1")).toBe("idle");
    });
  });

  describe("re-provision after stop/destroy", () => {
    it("can provision after stop", async () => {
      const adapter = new TestAdapter();
      await collect(adapter.provision("env-1", {}, "token"));
      await adapter.connect("env-1", {}, "token");
      await adapter.stop("env-1", {});
      await collect(adapter.provision("env-1", {}, "token"));
      expect(adapter.getState("env-1")).toBe("provisioned");
    });

    it("can provision after destroy", async () => {
      const adapter = new TestAdapter();
      await collect(adapter.provision("env-1", {}, "token"));
      await adapter.connect("env-1", {}, "token");
      await adapter.destroy("env-1", {});
      await collect(adapter.provision("env-1", {}, "token"));
      expect(adapter.getState("env-1")).toBe("provisioned");
    });
  });

  describe("withProvisionLock", () => {
    it("provides mutex and state transitions for reconnect", async () => {
      class ReconnectableAdapter extends TestAdapter {
        public async *reconnect(
          environmentId: string,
          config: Record<string, unknown>,
          powerlineToken: string,
        ): AsyncGenerator<ProvisionEvent> {
          yield* this.withProvisionLock(
            environmentId,
            this.doReconnectImpl(environmentId, config, powerlineToken),
          );
        }

        private async *doReconnectImpl(
          _environmentId: string,
          _config: Record<string, unknown>,
          _powerlineToken: string,
        ): AsyncGenerator<ProvisionEvent> {
          yield { stage: "reconnecting", message: "reconnected", progress: 1 };
        }
      }

      const adapter = new ReconnectableAdapter();
      const events = await collect(adapter.reconnect("env-1", {}, "token"));

      expect(events).toHaveLength(1);
      expect(events[0].stage).toBe("reconnecting");
      expect(adapter.getState("env-1")).toBe("provisioned");
    });
  });

  describe("environment isolation", () => {
    it("tracks state independently per environment", async () => {
      const adapter = new TestAdapter();

      await collect(adapter.provision("env-1", {}, "token"));
      await adapter.connect("env-1", {}, "token");

      await collect(adapter.provision("env-2", {}, "token"));

      expect(adapter.getState("env-1")).toBe("connected");
      expect(adapter.getState("env-2")).toBe("provisioned");
      expect(adapter.getState("env-3")).toBe("idle");
    });
  });
});
