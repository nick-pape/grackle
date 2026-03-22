import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";

// ── Mock logger before importing ──────────────
vi.mock("./logger.js", () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { LocalPowerLineManager, type LocalPowerLineManagerOptions } from "./local-powerline-manager.js";
import type { ProcessFactory, PortProbe } from "./local-powerline.js";

/** Create a minimal mock ChildProcess backed by an EventEmitter. */
function createMockProcess(): ChildProcess {
  const emitter = new EventEmitter();
  const mock = emitter as unknown as ChildProcess;
  mock.pid = 12345;
  mock.stdout = new PassThrough();
  mock.stderr = new PassThrough();
  mock.kill = vi.fn(() => true);
  return mock;
}

/** Build default test options with injected mocks. */
function createOptions(overrides?: Partial<LocalPowerLineManagerOptions>): LocalPowerLineManagerOptions & {
  processFactory: ProcessFactory;
  portProbe: PortProbe;
  mockProcesses: ChildProcess[];
} {
  const mockProcesses: ChildProcess[] = [];

  const processFactory: ProcessFactory = {
    spawn: vi.fn(() => {
      const proc = createMockProcess();
      mockProcesses.push(proc);
      return proc;
    }),
  };

  const portProbe: PortProbe = {
    waitForPort: vi.fn(async () => {}),
  };

  return {
    port: 7433,
    host: "127.0.0.1",
    token: "test-token",
    maxRestarts: 3,
    restartWindowMs: 60_000,
    processFactory,
    portProbe,
    resolveEntryPoint: () => "/fake/powerline.js",
    mockProcesses,
    ...overrides,
  };
}

describe("LocalPowerLineManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts and returns a handle", async () => {
    const opts = createOptions();
    const manager = new LocalPowerLineManager(opts);

    await manager.start();

    expect(manager.getHandle()).toBeDefined();
    expect(manager.getHandle()!.process.pid).toBe(12345);
    expect(opts.processFactory.spawn).toHaveBeenCalledOnce();
  });

  it("stop gracefully shuts down and clears handle", async () => {
    const opts = createOptions();
    const manager = new LocalPowerLineManager(opts);

    await manager.start();
    const process = opts.mockProcesses[0];

    // Start stop (will wait for exit)
    const stopPromise = manager.stop();

    // Simulate the child exiting
    (process as unknown as EventEmitter).emit("exit", 0, null);
    await stopPromise;

    expect(manager.getHandle()).toBeUndefined();
  });

  it("restarts on unexpected exit", async () => {
    const onStatusChange = vi.fn();
    const onRestarted = vi.fn();
    const opts = createOptions({ onStatusChange, onRestarted });
    const manager = new LocalPowerLineManager(opts);

    await manager.start();
    const firstProcess = opts.mockProcesses[0];

    // Simulate unexpected exit
    (firstProcess as unknown as EventEmitter).emit("exit", 1, null);

    // Wait for async restart to fully complete (onRestarted fires after waitForPort resolves)
    await vi.waitFor(() => {
      expect(onRestarted).toHaveBeenCalledOnce();
    });

    expect(onStatusChange).toHaveBeenCalledWith("disconnected");
    expect(opts.mockProcesses).toHaveLength(2);
    expect(manager.getHandle()).toBeDefined();
    expect(manager.getHandle()!.process).toBe(opts.mockProcesses[1]);
  });

  it("does not restart during graceful shutdown", async () => {
    const onStatusChange = vi.fn();
    const opts = createOptions({ onStatusChange });
    const manager = new LocalPowerLineManager(opts);

    await manager.start();
    const firstProcess = opts.mockProcesses[0];

    // Start graceful stop
    const stopPromise = manager.stop();

    // Simulate exit (should be ignored because stoppingGracefully is true)
    (firstProcess as unknown as EventEmitter).emit("exit", 0, null);
    await stopPromise;

    // Give time for any accidental restart
    await new Promise((r) => setTimeout(r, 50));

    // Should not have spawned a second process
    expect(opts.mockProcesses).toHaveLength(1);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("stop during in-flight restart awaits and cleans up new handle", async () => {
    let resolveProbe: (() => void) | undefined;
    let probeCallCount = 0;
    const slowPortProbe: PortProbe = {
      waitForPort: vi.fn(async () => {
        probeCallCount++;
        if (probeCallCount > 1) {
          await new Promise<void>((r) => { resolveProbe = r; });
        }
      }),
    };

    const opts = createOptions({ portProbe: slowPortProbe });
    const manager = new LocalPowerLineManager(opts);

    await manager.start();

    // Simulate crash — restart starts but blocks on port probe
    (opts.mockProcesses[0] as unknown as EventEmitter).emit("exit", 1, null);
    await vi.waitFor(() => {
      expect(opts.mockProcesses).toHaveLength(2);
    });

    // Call stop while restart is in progress — stop() awaits the restart promise
    const stopPromise = manager.stop();

    // Unblock the restart — restart returns early (stoppingGracefully), then
    // stop() sees the new handle and stops it
    resolveProbe!();

    // stop() will call handle.stop() → SIGTERM on the new process
    await vi.waitFor(() => {
      expect((opts.mockProcesses[1].kill as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("SIGTERM");
    });

    // Simulate the new process exiting so stop() can complete
    (opts.mockProcesses[1] as unknown as EventEmitter).emit("exit", 0, null);

    await stopPromise;
    expect(manager.getHandle()).toBeUndefined();
  });

  it("trips circuit breaker after max restarts in window", async () => {
    const onStatusChange = vi.fn();
    const onRestarted = vi.fn();
    const opts = createOptions({ onStatusChange, onRestarted, maxRestarts: 2, restartWindowMs: 60_000 });
    const manager = new LocalPowerLineManager(opts);

    await manager.start();

    // First crash → restart succeeds
    (opts.mockProcesses[0] as unknown as EventEmitter).emit("exit", 1, null);
    await vi.waitFor(() => {
      expect(onRestarted).toHaveBeenCalledTimes(1);
    });

    // Second crash → restart succeeds (2nd restart, hits max)
    (opts.mockProcesses[1] as unknown as EventEmitter).emit("exit", 1, null);
    await vi.waitFor(() => {
      expect(onRestarted).toHaveBeenCalledTimes(2);
    });

    // Third crash → circuit breaker trips, no restart
    onStatusChange.mockClear();
    (opts.mockProcesses[2] as unknown as EventEmitter).emit("exit", 1, null);

    // Wait for the restart attempt to check the circuit breaker
    await new Promise((r) => setTimeout(r, 50));

    // Should NOT have spawned a 4th process
    expect(opts.mockProcesses).toHaveLength(3);
    expect(onStatusChange).toHaveBeenCalledWith("disconnected"); // from onExit
    expect(onStatusChange).toHaveBeenCalledWith("error"); // from circuit breaker
  });

  it("circuit breaker resets after time window elapses", async () => {
    const onRestarted = vi.fn();
    const opts = createOptions({ onRestarted, maxRestarts: 2, restartWindowMs: 1_000 });
    const manager = new LocalPowerLineManager(opts);

    await manager.start();

    // Two crashes (uses up the quota)
    (opts.mockProcesses[0] as unknown as EventEmitter).emit("exit", 1, null);
    await vi.waitFor(() => {
      expect(onRestarted).toHaveBeenCalledTimes(1);
    });

    (opts.mockProcesses[1] as unknown as EventEmitter).emit("exit", 1, null);
    await vi.waitFor(() => {
      expect(onRestarted).toHaveBeenCalledTimes(2);
    });

    // Wait for the restart window to expire
    await new Promise((r) => setTimeout(r, 1_100));

    // Third crash should succeed because the window reset
    (opts.mockProcesses[2] as unknown as EventEmitter).emit("exit", 1, null);
    await vi.waitFor(() => {
      expect(onRestarted).toHaveBeenCalledTimes(3);
    });
  });

  it("prevents concurrent restarts but retries pending exit", async () => {
    // Use a slow port probe to simulate a restart in progress
    const probeResolvers: (() => void)[] = [];
    let probeCallCount = 0;
    const slowPortProbe: PortProbe = {
      waitForPort: vi.fn(async () => {
        probeCallCount++;
        if (probeCallCount > 1) {
          // Second+ calls: slow to simulate in-progress restart
          await new Promise<void>((r) => { probeResolvers.push(r); });
        }
      }),
    };

    const onRestarted = vi.fn();
    const opts = createOptions({ onRestarted, portProbe: slowPortProbe });
    const manager = new LocalPowerLineManager(opts);

    await manager.start();

    // Simulate first crash — restart starts but blocks on port probe
    (opts.mockProcesses[0] as unknown as EventEmitter).emit("exit", 1, null);

    // Wait for spawn to be called (restart #1 in progress)
    await vi.waitFor(() => {
      expect(opts.mockProcesses).toHaveLength(2);
    });

    // Simulate second exit while first restart is still in progress.
    // This should not spawn concurrently, but should queue a pending restart.
    (opts.mockProcesses[1] as unknown as EventEmitter).emit("exit", 1, null);

    // Give time for any concurrent restart to start
    await new Promise((r) => setTimeout(r, 50));

    // Should still only have 2 processes (no concurrent spawn)
    expect(opts.mockProcesses).toHaveLength(2);

    // Unblock the first restart — it completes, then the pending restart fires
    probeResolvers[0]();

    // Wait for the pending restart to spawn a 3rd process and complete
    await vi.waitFor(() => {
      expect(probeResolvers).toHaveLength(2);
    });
    probeResolvers[1]();

    await vi.waitFor(() => {
      expect(onRestarted).toHaveBeenCalledTimes(2);
    });

    expect(opts.mockProcesses).toHaveLength(3);
  });

  it("sets error status when restart fails", async () => {
    const onStatusChange = vi.fn();
    let callCount = 0;

    const opts = createOptions({
      onStatusChange,
      portProbe: {
        waitForPort: vi.fn(async () => {
          callCount++;
          if (callCount > 1) {
            throw new Error("Port unavailable");
          }
        }),
      },
    });
    const manager = new LocalPowerLineManager(opts);

    await manager.start();

    // Simulate crash — restart will fail because port probe throws
    (opts.mockProcesses[0] as unknown as EventEmitter).emit("exit", 1, null);

    // Wait for restart attempt
    await new Promise((r) => setTimeout(r, 50));

    expect(onStatusChange).toHaveBeenCalledWith("disconnected"); // from onExit
    expect(onStatusChange).toHaveBeenCalledWith("error"); // from failed restart
  });

  it("handle is undefined after restart failure", async () => {
    let callCount = 0;
    const opts = createOptions({
      portProbe: {
        waitForPort: vi.fn(async () => {
          callCount++;
          if (callCount > 1) {
            throw new Error("Port unavailable");
          }
        }),
      },
    });
    const manager = new LocalPowerLineManager(opts);

    await manager.start();
    expect(manager.getHandle()).toBeDefined();

    // Simulate crash → restart fails
    (opts.mockProcesses[0] as unknown as EventEmitter).emit("exit", 1, null);
    await new Promise((r) => setTimeout(r, 50));

    expect(manager.getHandle()).toBeUndefined();
  });
});
