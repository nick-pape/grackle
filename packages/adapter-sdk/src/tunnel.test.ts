import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";

// Mock sleep to avoid real 1s delays in close() tests
vi.mock("./utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./utils.js")>();
  return { ...original, sleep: vi.fn().mockResolvedValue(undefined) };
});

import type { TunnelProcessFactory, TunnelPortProbe } from "./tunnel.js";
import { ProcessTunnel } from "./tunnel.js";

// ── Silent logger ────────────────────────────────────────────

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// ── Mock helpers ─────────────────────────────────────────────

/** Create a fake ChildProcess with configurable exitCode. */
function createMockProcess(opts?: { exitCode?: number | null }): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stderr = new EventEmitter();
  Object.defineProperty(proc, "stderr", { value: stderr, writable: false });
  Object.defineProperty(proc, "exitCode", { value: opts?.exitCode ?? null, writable: true });
  proc.kill = vi.fn().mockImplementation((signal?: string) => {
    if (signal === "SIGTERM" || signal === "SIGKILL") {
      (proc as unknown as { exitCode: number | null }).exitCode = 0;
    }
    return true;
  });
  return proc;
}

function createMockProcessFactory(process?: ChildProcess): TunnelProcessFactory {
  return {
    spawn: vi.fn().mockReturnValue(process ?? createMockProcess()),
  };
}

function createMockPortProbe(): TunnelPortProbe {
  return {
    waitForPort: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Concrete test subclass ───────────────────────────────────

class TestTunnel extends ProcessTunnel {
  public readonly testCommand: string;
  public readonly testArgs: string[];

  public constructor(
    localPort: number,
    command: string,
    args: string[],
    processFactory?: TunnelProcessFactory,
    portProbe?: TunnelPortProbe,
  ) {
    super(localPort, silentLogger, processFactory, portProbe);
    this.testCommand = command;
    this.testArgs = args;
  }

  protected spawnArgs(): { command: string; args: string[] } {
    return { command: this.testCommand, args: this.testArgs };
  }
}

// ── Tests ────────────────────────────────────────────────────

describe("ProcessTunnel", () => {
  let factory: TunnelProcessFactory;
  let probe: TunnelPortProbe;
  let tunnel: TestTunnel;

  beforeEach(() => {
    vi.clearAllMocks();
    factory = createMockProcessFactory();
    probe = createMockPortProbe();
    tunnel = new TestTunnel(9999, "ssh", ["-N", "-L", "9999:127.0.0.1:7433"], factory, probe);
  });

  describe("open()", () => {
    it("calls processFactory.spawn() with correct command and args", async () => {
      await tunnel.open();

      expect(factory.spawn).toHaveBeenCalledOnce();
      expect(factory.spawn).toHaveBeenCalledWith(
        "ssh",
        ["-N", "-L", "9999:127.0.0.1:7433"],
        expect.objectContaining({ stdio: ["ignore", "ignore", "pipe"], detached: false }),
      );
    });

    it("calls portProbe.waitForPort() with the local port", async () => {
      await tunnel.open();

      expect(probe.waitForPort).toHaveBeenCalledOnce();
      expect(probe.waitForPort).toHaveBeenCalledWith(9999);
    });

    it("closes and rethrows when waitForPort fails", async () => {
      (probe.waitForPort as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("port unreachable"));

      await expect(tunnel.open()).rejects.toThrow("port unreachable");
      // Process should have been cleaned up
      expect(tunnel.isAlive()).toBe(false);
    });
  });

  describe("close()", () => {
    it("sends SIGTERM to the tunnel process", async () => {
      const proc = createMockProcess();
      // Make kill not immediately set exitCode so we can test SIGTERM call
      proc.kill = vi.fn().mockReturnValue(true);
      factory = createMockProcessFactory(proc);
      tunnel = new TestTunnel(9999, "ssh", ["-N"], factory, probe);

      await tunnel.open();
      await tunnel.close();

      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("sends SIGKILL if process does not exit after SIGTERM", async () => {
      const proc = createMockProcess();
      // Keep exitCode as null (process doesn't respond to SIGTERM)
      proc.kill = vi.fn().mockReturnValue(true);
      factory = createMockProcessFactory(proc);
      tunnel = new TestTunnel(9999, "ssh", ["-N"], factory, probe);

      await tunnel.open();
      await tunnel.close();

      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
      expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    });

    it("does nothing if process already exited", async () => {
      const proc = createMockProcess({ exitCode: 0 });
      factory = createMockProcessFactory(proc);
      tunnel = new TestTunnel(9999, "ssh", ["-N"], factory, probe);

      await tunnel.open();
      await tunnel.close();

      expect(proc.kill).not.toHaveBeenCalled();
    });
  });

  describe("isAlive()", () => {
    it("returns false before open() is called", () => {
      expect(tunnel.isAlive()).toBe(false);
    });

    it("returns true when process is running (exitCode === null)", async () => {
      await tunnel.open();
      expect(tunnel.isAlive()).toBe(true);
    });

    it("returns false after close()", async () => {
      await tunnel.open();
      await tunnel.close();
      expect(tunnel.isAlive()).toBe(false);
    });
  });

  describe("waitForReady() override", () => {
    it("allows subclasses to override waitForReady behavior", async () => {
      const customWaitFn = vi.fn().mockResolvedValue(undefined);

      class CustomTunnel extends ProcessTunnel {
        protected spawnArgs(): { command: string; args: string[] } {
          return { command: "test", args: [] };
        }
        protected async waitForReady(): Promise<void> {
          await customWaitFn();
        }
      }

      const customTunnel = new CustomTunnel(9999, silentLogger, factory, probe);
      await customTunnel.open();

      // Should have called custom waitForReady, not portProbe
      expect(customWaitFn).toHaveBeenCalledOnce();
      expect(probe.waitForPort).not.toHaveBeenCalled();
    });
  });
});
