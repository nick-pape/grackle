import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
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

import {
  startLocalPowerLine,
  type ProcessFactory,
  type PortProbe,
  type StartLocalPowerLineOptions,
} from "./local-powerline.js";
import { logger as parentLogger } from "./logger.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const childLogger = (parentLogger.child as Mock).mock.results[0]?.value as any;

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
function createMockOptions(overrides?: Partial<StartLocalPowerLineOptions>): StartLocalPowerLineOptions {
  const mockProcess = createMockProcess();
  const processFactory: ProcessFactory = {
    spawn: vi.fn(() => mockProcess),
  };
  const portProbe: PortProbe = {
    waitForPort: vi.fn(async () => {}),
  };

  return {
    port: 7433,
    host: "127.0.0.1",
    token: "test-token",
    processFactory,
    portProbe,
    resolveEntryPoint: () => "/fake/powerline.js",
    ...overrides,
  };
}

describe("startLocalPowerLine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Re-capture the child logger after restoreAllMocks
    if (childLogger) {
      childLogger.info = vi.fn();
      childLogger.warn = vi.fn();
      childLogger.error = vi.fn();
      childLogger.debug = vi.fn();
    }
  });

  it("spawns with correct args and env", async () => {
    const options = createMockOptions();
    await startLocalPowerLine(options);

    const spawnFn = (options.processFactory!.spawn as Mock);
    expect(spawnFn).toHaveBeenCalledOnce();

    const [command, args, spawnOpts] = spawnFn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toEqual(["/fake/powerline.js", "--port", "7433", "--host", "127.0.0.1"]);
    expect(spawnOpts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(spawnOpts.env.GRACKLE_POWERLINE_TOKEN).toBe("test-token");
  });

  it("waits for port before returning", async () => {
    const options = createMockOptions();
    await startLocalPowerLine(options);

    const waitFn = (options.portProbe!.waitForPort as Mock);
    expect(waitFn).toHaveBeenCalledOnce();
    expect(waitFn).toHaveBeenCalledWith(7433, "127.0.0.1", 15_000);
  });

  it("returns handle with stop and process", async () => {
    const options = createMockOptions();
    const handle = await startLocalPowerLine(options);

    expect(handle).toHaveProperty("stop");
    expect(handle).toHaveProperty("process");
    expect(typeof handle.stop).toBe("function");
    expect(handle.process.pid).toBe(12345);
  });

  it("calls onExit when child exits", async () => {
    const onExit = vi.fn();
    const options = createMockOptions({ onExit });
    const handle = await startLocalPowerLine(options);

    (handle.process as unknown as EventEmitter).emit("exit", 1, null);
    expect(onExit).toHaveBeenCalledWith(1, undefined);
  });

  it("kills child on port probe timeout", async () => {
    const mockProcess = createMockProcess();
    const processFactory: ProcessFactory = { spawn: vi.fn(() => mockProcess) };
    const portProbe: PortProbe = {
      waitForPort: vi.fn(async () => {
        throw new Error("Timeout");
      }),
    };
    const options = createMockOptions({ processFactory, portProbe });

    await expect(startLocalPowerLine(options)).rejects.toThrow("Timeout");
    expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("throws descriptive error on early exit", async () => {
    const mockProcess = createMockProcess();
    const processFactory: ProcessFactory = { spawn: vi.fn(() => mockProcess) };
    const portProbe: PortProbe = {
      waitForPort: vi.fn(async () => {
        // Simulate the child exiting before port is ready
        (mockProcess as unknown as EventEmitter).emit("exit", 1, null);
        throw new Error("Timeout");
      }),
    };
    const options = createMockOptions({ processFactory, portProbe });

    await expect(startLocalPowerLine(options)).rejects.toThrow(
      "PowerLine process exited before accepting connections on port 7433",
    );
  });

  it("stop sends SIGTERM then SIGKILL after timeout", async () => {
    vi.useFakeTimers();
    const options = createMockOptions();
    const handle = await startLocalPowerLine(options);
    const child = handle.process;

    const stopPromise = handle.stop();

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Advance past the STOP_TIMEOUT_MS (2000ms)
    await vi.advanceTimersByTimeAsync(2_000);

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    // Let the process exit to resolve the stop promise
    (child as unknown as EventEmitter).emit("exit", null, "SIGKILL");
    await stopPromise;

    vi.useRealTimers();
  });

  it("stop is no-op after exit", async () => {
    const options = createMockOptions();
    const handle = await startLocalPowerLine(options);

    // Simulate the child exiting
    (handle.process as unknown as EventEmitter).emit("exit", 0, null);

    await handle.stop();
    expect(handle.process.kill).not.toHaveBeenCalled();
  });

  it("rewrites 0.0.0.0 to 127.0.0.1 for probe", async () => {
    const options = createMockOptions({ host: "0.0.0.0" });
    await startLocalPowerLine(options);

    const waitFn = (options.portProbe!.waitForPort as Mock);
    expect(waitFn).toHaveBeenCalledWith(7433, "127.0.0.1", 15_000);
  });

  it("pipes stdout through logger", async () => {
    const options = createMockOptions();
    const handle = await startLocalPowerLine(options);

    handle.process.stdout!.emit("data", Buffer.from("hello from powerline\n"));

    expect(childLogger.info).toHaveBeenCalledWith("hello from powerline");
  });

  it("pipes stderr through logger as warnings", async () => {
    const options = createMockOptions();
    const handle = await startLocalPowerLine(options);

    handle.process.stderr!.emit("data", Buffer.from("warning message\n"));

    expect(childLogger.warn).toHaveBeenCalledWith("warning message");
  });
});
