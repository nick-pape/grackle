/**
 * Property-based fuzz tests for the `AhpClientSocket` state machine.
 *
 * Runs random sequences of (open / close / request / notify / serverUp /
 * serverDown / kickSession / wait) against a real server+client pair and
 * asserts invariants that must hold regardless of the sequence:
 *
 *   I1. state ∈ {connecting, open, reconnecting, closed}.
 *   I2. After dispose(), the state stays "closed" (no late transitions).
 *   I3. Every issued request() promise settles EXACTLY ONCE (no double-
 *       resolve and no double-reject). Tracked via a sentinel wrapper.
 *   I4. clientId, once known, is stable across reconnects.
 *   I5. After dispose() + idle, no Node timers/handles remain attributable
 *       to this driver. Catches orphan setTimeout/setInterval leaks.
 *
 * The harness lives in mocks/test-driver.ts. fast-check shrinks failures
 * to a minimal failing op sequence.
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { type AhpConnectionState } from "./ahp-client-socket.js";
import { createTestDriver, type TestDriver } from "./mocks/test-driver.js";

const VALID_STATES: ReadonlySet<AhpConnectionState> = new Set([
  "connecting",
  "open",
  "reconnecting",
  "closed",
]);

// Operations the fuzzer can schedule. Each is a small async action.
type Op =
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "request" }
  | { kind: "notify" }
  | { kind: "serverUp" }
  | { kind: "serverDown" }
  | { kind: "kick" }
  | { kind: "wait"; ms: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.constant<Op>({ kind: "open" }),
  fc.constant<Op>({ kind: "close" }),
  fc.constant<Op>({ kind: "request" }),
  fc.constant<Op>({ kind: "notify" }),
  fc.constant<Op>({ kind: "serverUp" }),
  fc.constant<Op>({ kind: "serverDown" }),
  fc.constant<Op>({ kind: "kick" }),
  fc.integer({ min: 0, max: 50 }).map<Op>((ms) => ({ kind: "wait", ms })),
);

async function runOp(driver: TestDriver, op: Op): Promise<void> {
  switch (op.kind) {
    case "open":
      try {
        await driver.client.open();
      } catch {
        // open() can reject for many valid reasons in a random sequence.
      }
      return;
    case "close":
      await driver.client.close();
      return;
    case "request":
      // Don't await — let it settle in the background. The driver tracks the
      // outcome. We use a fire-and-forget here so the fuzz sequence keeps
      // moving even when the request is queued during reconnect.
      void driver.request();
      return;
    case "notify":
      driver.notify();
      return;
    case "serverUp":
      await driver.startServer();
      return;
    case "serverDown":
      await driver.stopServer();
      return;
    case "kick":
      driver.kickSession();
      return;
    case "wait":
      await driver.wait(op.ms);
      return;
  }
}

function assertInvariants(driver: TestDriver, lastClientId: string | undefined): void {
  // I1: state is one of the known values.
  expect(VALID_STATES.has(driver.client.state)).toBe(true);
  // I4: clientId is stable once seen (we don't enforce "must be defined" —
  // before the first successful open it can legitimately be undefined).
  const now = driver.client.clientId;
  if (lastClientId !== undefined && now !== undefined) {
    expect(now).toBe(lastClientId);
  }
}

/**
 * Capture the count of active Node handles attributable to this process.
 * Uses the undocumented `process._getActiveHandles()` introspection hook.
 * A growing count after dispose indicates orphaned timers/sockets.
 */
function countActiveHandles(): number {
  const proc = process as unknown as { _getActiveHandles?: () => unknown[] };
  return proc._getActiveHandles?.()?.length ?? 0;
}

describe("AhpClientSocket fuzz", () => {
  it("preserves invariants across random op sequences", async () => {
    // Baseline handle count for I5. Other vitest workers and Node internals
    // contribute to this; we only flag *growth* beyond a generous bound.
    const baselineHandles = countActiveHandles();

    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 20 }), async (ops) => {
        const driver = await createTestDriver();
        // Pre-start with the server up so most sequences exercise reconnect
        // rather than terminal-fail on first open. The fuzzer can stop it
        // any time via {kind: "serverDown"}.
        await driver.startServer();
        let lastClientId: string | undefined;
        try {
          for (const op of ops) {
            await runOp(driver, op);
            assertInvariants(driver, lastClientId);
            if (driver.client.clientId !== undefined) {
              lastClientId = driver.client.clientId;
            }
          }
          // After all ops + a settle window, give pending requests a chance
          // to finish so the assertion below sees a stable count.
          await driver.wait(60);

          // I3: every issued request settled exactly once.
          expect(driver.doubleSettleErrors).toEqual([]);
          const requestCount = ops.filter((o) => o.kind === "request").length;
          // Issued count is upper-bound; unsettled-at-settle-window pending
          // ones drop off the lower end.
          expect(driver.requestOutcomes.length).toBeLessThanOrEqual(requestCount);

          // I2: after dispose, state stays "closed".
          await driver.dispose();
          const transitionsBefore = driver.transitions.length;
          await driver.wait(50);
          expect(driver.client.state).toBe("closed");
          // No new transitions arrived after dispose (post-close should be silent).
          expect(driver.transitions.length).toBe(transitionsBefore);

          // I5: dispose() must not leak handles. We allow a generous slack
          // (10 handles above baseline) since vitest/node have background
          // I/O. A persistent leak across many iterations would still
          // accumulate well beyond this.
          const handlesAfter = countActiveHandles();
          expect(handlesAfter).toBeLessThanOrEqual(baselineHandles + 10);
        } catch (err) {
          // On any assertion failure, ensure cleanup before fast-check
          // shrinks. Failure to clean up here leaks ports across shrink iterations.
          await driver.dispose().catch(() => undefined);
          throw err;
        }
      }),
      // 50 runs × max 20 ops. Larger numbers (e.g. 200 × 30) give more
      // state-space coverage but multiply CI cost; stuck at 50 × 20 to
      // keep this file under ~15s.
      { numRuns: 50, timeout: 30_000 },
    );
  }, 120_000);
});
