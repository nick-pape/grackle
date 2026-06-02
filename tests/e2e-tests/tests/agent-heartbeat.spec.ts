/**
 * Live verification of Agent heartbeat (#1438).
 *
 * Setup: create a stub-runtime Agent and attach a 10s heartbeat. Cron-phase
 * (running at 2s ticks via `GRACKLE_RECONCILIATION_TICK_MS=2000` in
 * server-manager.ts) will fire the heartbeat at ~10s and again at ~20s.
 *
 * Assertions:
 *   - The agent has exactly ONE session under its root task across both wakes
 *     (proves the second tick reanimated the first session, not spawned a new one).
 *   - The heartbeat schedule's `runCount` advances by 2.
 */
import { test, expect } from "./fixtures.js";

const TEST_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 500;

interface SessionLike {
  id: string;
  runtimeSessionId: string;
}

/** Poll `getTaskSessions(taskId)` until it returns at least one session, or timeout. */
async function waitForFirstSession(
  client: {
    core: { getTaskSessions: (req: { id: string }) => Promise<{ sessions: SessionLike[] }> };
  },
  taskId: string,
  timeoutMs: number,
): Promise<SessionLike> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await client.core.getTaskSessions({ id: taskId });
    if (res.sessions.length > 0) {
      return res.sessions[0]!;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for first session on task ${taskId}`);
}

/** Poll until the schedule's runCount reaches at least `target`. */
async function waitForRunCount(
  client: {
    orchestration: {
      getAgent: (req: { id: string }) => Promise<{ heartbeat?: { runCount: number } }>;
    };
  },
  agentId: string,
  target: number,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = -1;
  while (Date.now() < deadline) {
    const a = await client.orchestration.getAgent({ id: agentId });
    const count = a.heartbeat?.runCount ?? 0;
    lastSeen = count;
    if (count >= target) {
      return count;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for heartbeat runCount >= ${target} (last seen: ${lastSeen})`,
  );
}

/** Generate a unique agent name per test run to avoid cross-test name collisions. */
function uniqueAgentName(prefix: string): string {
  return `${prefix}-${Math.floor(Date.now() / 1000)}-${Math.floor(Math.random() * 10000)}`;
}

test("agent heartbeat fires twice and reanimates the same session on the second tick", async ({
  grackle: { client },
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);

  // Pick a unique agent name per test run to avoid duplicates across reruns
  // sharing the same worker DB (rarely needed but cheap).
  const agentName = uniqueAgentName("HB");

  // Create the agent. The Agent root task is auto-created by the
  // createAgentRootTaskSubscriber (#1418).
  const agent = await client.orchestration.createAgent({
    name: agentName,
    environmentId: "test-local",
    primaryPersonaId: "stub",
  });

  // Attach a heartbeat. Cadence floor is 10s (validateExpression). Rules text
  // is what the cron-phase pipes into the runtime as the first user message —
  // for the stub runtime, a plain string is treated as a default-scenario
  // prompt that emits one text turn and then transitions to STOPPED.
  await client.orchestration.setAgentHeartbeat({
    agentId: agent.id,
    cadence: "10s",
    rules: "PING",
  });

  // Resolve the heartbeat → the schedule's parentTaskId is the agent's root
  // task (we wire it that way in `setAgentHeartbeat`). That's where the
  // sessions land.
  const agentWithHeartbeat = await client.orchestration.getAgent({ id: agent.id });
  expect(agentWithHeartbeat.heartbeat?.id).toBeTruthy();
  const rootTaskId = agentWithHeartbeat.heartbeat!.parentTaskId;
  expect(rootTaskId).toBeTruthy();

  // Wait for the first tick (~10–14s including reconciliation poll jitter).
  const firstSession = await waitForFirstSession(client, rootTaskId, 18_000);
  expect(firstSession.id).toBeTruthy();

  // Wait for the second tick — runCount goes from 1 → 2 within ~12s more.
  await waitForRunCount(client, agent.id, 2, 18_000);

  // The reanimation invariant: there is still EXACTLY ONE session attached to
  // the root task. A fresh-spawn second tick would have produced two rows.
  const after = await client.core.getTaskSessions({ id: rootTaskId });
  expect(after.sessions).toHaveLength(1);
  expect(after.sessions[0]!.id).toBe(firstSession.id);
});

// ── Phase 4 scenarios (#1438 hardening) ─────────────────────────────

test("agent heartbeat pause/resume: paused schedule doesn't fire; resume picks back up", async ({
  grackle: { client },
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);

  const agentName = uniqueAgentName("HB-Pause");
  const agent = await client.orchestration.createAgent({
    name: agentName,
    environmentId: "test-local",
    primaryPersonaId: "stub",
  });
  await client.orchestration.setAgentHeartbeat({
    agentId: agent.id,
    cadence: "10s",
    rules: "PING",
  });

  // Wait for the first fire.
  await waitForRunCount(client, agent.id, 1, 14_000);
  const paused = await client.orchestration.setAgentHeartbeat({
    agentId: agent.id,
    enabled: false,
  });
  expect(paused.enabled).toBe(false);
  // Pausing clears nextRunAt (matches setScheduleEnabled semantics).
  expect(paused.nextRunAt).toBe("");

  // Wait one cadence cycle while paused — runCount must stay at 1.
  await new Promise((r) => setTimeout(r, 12_000));
  const stillPaused = await client.orchestration.getAgent({ id: agent.id });
  expect(stillPaused.heartbeat?.runCount).toBe(1);

  // Resume — runCount eventually reaches 2.
  const resumed = await client.orchestration.setAgentHeartbeat({
    agentId: agent.id,
    enabled: true,
  });
  expect(resumed.enabled).toBe(true);
  expect(resumed.nextRunAt).toBeTruthy();

  await waitForRunCount(client, agent.id, 2, 14_000);
});

test("agent heartbeat rejects an invalid cadence and creates no schedule row", async ({
  grackle: { client },
}) => {
  test.setTimeout(15_000);

  const agentName = uniqueAgentName("HB-Bad");
  const agent = await client.orchestration.createAgent({
    name: agentName,
    environmentId: "test-local",
    primaryPersonaId: "stub",
  });

  await expect(
    client.orchestration.setAgentHeartbeat({
      agentId: agent.id,
      cadence: "garbage-not-a-cadence",
    }),
  ).rejects.toThrow(/Invalid|expression/i);

  const after = await client.orchestration.getAgent({ id: agent.id });
  // No heartbeat row was created.
  expect(after.heartbeat?.id || "").toBe("");
});

test("agent heartbeat clear deletes the schedule and stops new fires", async ({
  grackle: { client },
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);

  const agentName = uniqueAgentName("HB-Clear");
  const agent = await client.orchestration.createAgent({
    name: agentName,
    environmentId: "test-local",
    primaryPersonaId: "stub",
  });
  await client.orchestration.setAgentHeartbeat({
    agentId: agent.id,
    cadence: "10s",
    rules: "PING",
  });

  // Wait for the first fire so we have something to compare against.
  await waitForRunCount(client, agent.id, 1, 14_000);
  const before = await client.orchestration.getAgent({ id: agent.id });
  const rootTaskId = before.heartbeat!.parentTaskId;
  const sessionsBefore = await client.core.getTaskSessions({ id: rootTaskId });

  // Clear: empty cadence deletes the schedule row.
  await client.orchestration.setAgentHeartbeat({
    agentId: agent.id,
    cadence: "",
  });
  const cleared = await client.orchestration.getAgent({ id: agent.id });
  expect(cleared.heartbeat?.id || "").toBe("");

  // Wait one full cadence cycle — no new sessions should land on the root task.
  await new Promise((r) => setTimeout(r, 12_000));
  const sessionsAfter = await client.core.getTaskSessions({ id: rootTaskId });
  expect(sessionsAfter.sessions).toHaveLength(sessionsBefore.sessions.length);
});
