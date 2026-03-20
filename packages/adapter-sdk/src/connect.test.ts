import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PortProber } from "./connect.js";
import { waitForLocalPort } from "./connect.js";

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
});

describe("waitForLocalPort", () => {
  it("resolves immediately when port is reachable on first probe", async () => {
    const prober = createMockProber([true]);

    await waitForLocalPort(4000, { portProber: prober, sleep: noopSleep });

    expect(prober.probe).toHaveBeenCalledTimes(1);
    expect(prober.probe).toHaveBeenCalledWith(4000);
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
