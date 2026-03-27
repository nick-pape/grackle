import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ConnectRPC to capture interceptors
const capturedTransportArgs: { interceptors?: unknown[] }[] = [];
vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: vi.fn((args: { interceptors?: unknown[] }) => {
    capturedTransportArgs.push(args);
    return {};
  }),
}));

vi.mock("@connectrpc/connect", () => ({
  createClient: vi.fn(() => ({})),
}));

import type { PortProber } from "./connect.js";
import { waitForLocalPort, createPowerLineClient } from "./connect.js";

// ── Helpers ──────────────────────────────────────────────────

function createMockProber(results: boolean[]): PortProber {
  let call = 0;
  return {
    probe: vi.fn(async () => results[call++] ?? false),
  };
}

const noopSleep = vi.fn(async (_ms: number) => {});

// ── Tests ────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  capturedTransportArgs.length = 0;
});

describe("waitForLocalPort", () => {
  it("resolves immediately when port is reachable on first probe", async () => {
    const prober = createMockProber([true]);

    await waitForLocalPort(4000, { portProber: prober, sleep: noopSleep });

    expect(prober.probe).toHaveBeenCalledTimes(1);
    expect(prober.probe).toHaveBeenCalledWith(4000, "127.0.0.1");
    expect(noopSleep).not.toHaveBeenCalled();
  });

  it("retries until port becomes reachable", async () => {
    const prober = createMockProber([false, false, false, true]);

    await waitForLocalPort(5000, { portProber: prober, sleep: noopSleep });

    expect(prober.probe).toHaveBeenCalledTimes(4);
    expect(noopSleep).toHaveBeenCalledTimes(3);
  });

  it("passes 500ms delay to sleep on each retry", async () => {
    const prober = createMockProber([false, true]);

    await waitForLocalPort(6000, { portProber: prober, sleep: noopSleep });

    expect(noopSleep).toHaveBeenCalledTimes(1);
    expect(noopSleep).toHaveBeenCalledWith(500);
  });

  it("throws after 20 max attempts when port never reachable", async () => {
    const alwaysFalse = Array.from<boolean>({ length: 20 }).fill(false);
    const prober = createMockProber(alwaysFalse);

    await expect(
      waitForLocalPort(7000, { portProber: prober, sleep: noopSleep }),
    ).rejects.toThrow("Local port 7000 did not become reachable after 20 attempts");

    expect(prober.probe).toHaveBeenCalledTimes(20);
    expect(noopSleep).toHaveBeenCalledTimes(20);
  });
});

describe("createPowerLineClient x-trace-id header", () => {
  it("sets x-trace-id header when traceId is provided", async () => {
    createPowerLineClient("http://127.0.0.1:7433", "test-token", "trace-abc");

    // The transport should have interceptors
    const args = capturedTransportArgs[0];
    expect(args.interceptors).toBeDefined();

    // Simulate an interceptor call to verify x-trace-id is set
    const interceptors = args.interceptors as Array<(next: (req: unknown) => Promise<unknown>) => (req: unknown) => Promise<unknown>>;

    const headers = new Map<string, string>();
    const mockReq = {
      header: {
        set: (key: string, value: string) => headers.set(key, value),
        get: (key: string) => headers.get(key),
      },
    };
    const mockNext = vi.fn(async (req: unknown) => req);

    // Run all interceptors in chain
    for (const interceptor of interceptors) {
      const wrappedNext = interceptor(mockNext);
      await wrappedNext(mockReq);
    }

    expect(headers.get("x-trace-id")).toBe("trace-abc");
  });

  it("does not set x-trace-id header when traceId is omitted", async () => {
    createPowerLineClient("http://127.0.0.1:7433", "test-token");

    const args = capturedTransportArgs[0];

    const headers = new Map<string, string>();
    const mockReq = {
      header: {
        set: (key: string, value: string) => headers.set(key, value),
        get: (key: string) => headers.get(key),
      },
    };
    const mockNext = vi.fn(async (req: unknown) => req);

    // Run all interceptors
    if (args.interceptors) {
      for (const interceptor of args.interceptors as Array<(next: (req: unknown) => Promise<unknown>) => (req: unknown) => Promise<unknown>>) {
        const wrappedNext = interceptor(mockNext);
        await wrappedNext(mockReq);
      }
    }

    expect(headers.has("x-trace-id")).toBe(false);
  });
});
