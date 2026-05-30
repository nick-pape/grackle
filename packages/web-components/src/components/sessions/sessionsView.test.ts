import { describe, it, expect } from "vitest";
import type { Environment, Session } from "../../hooks/types.js";
import {
  buildStatusChips,
  describeSessionStatus,
  filterSessions,
  groupSessionsByEnvironment,
  isActiveSession,
  isActiveTone,
  sessionMatchesQuery,
  TONE_ORDER,
} from "./sessionsView.js";

/** Build a session with sensible defaults, overridable per-test. */
function makeSession(over: Partial<Session> & { id: string }): Session {
  return {
    environmentId: "env-1",
    runtime: "claude-code",
    status: "running",
    prompt: "Do the thing",
    startedAt: "2026-02-27T08:00:00Z",
    ...over,
  };
}

/** Build an environment with sensible defaults. */
function makeEnv(over: Partial<Environment> & { id: string }): Environment {
  return {
    displayName: over.id,
    adapterType: "local",
    adapterConfig: "{}",
    status: "connected",
    bootstrapped: true,
    githubAccountId: "",
    ...over,
  };
}

describe("describeSessionStatus", () => {
  it("maps raw database statuses to tones", () => {
    expect(describeSessionStatus({ status: "running" })).toEqual({
      tone: "running",
      label: "Running",
    });
    expect(describeSessionStatus({ status: "idle" }).tone).toBe("idle");
    expect(describeSessionStatus({ status: "waiting_input" }).tone).toBe("idle");
    expect(describeSessionStatus({ status: "pending" }).tone).toBe("pending");
    expect(describeSessionStatus({ status: "suspended" })).toEqual({
      tone: "paused",
      label: "Suspended",
    });
    expect(describeSessionStatus({ status: "hibernating" }).label).toBe("Hibernating");
    expect(describeSessionStatus({ status: "completed" }).tone).toBe("success");
    expect(describeSessionStatus({ status: "failed" }).tone).toBe("error");
    expect(describeSessionStatus({ status: "killed" }).tone).toBe("error");
    expect(describeSessionStatus({ status: "interrupted" }).tone).toBe("error");
    expect(describeSessionStatus({ status: "terminated" }).tone).toBe("error");
  });

  it("disambiguates the generic stopped status by endReason", () => {
    expect(describeSessionStatus({ status: "stopped", endReason: "completed" })).toEqual({
      tone: "success",
      label: "Completed",
    });
    expect(describeSessionStatus({ status: "stopped", endReason: "killed" }).tone).toBe("error");
    expect(describeSessionStatus({ status: "stopped", endReason: "interrupted" }).tone).toBe(
      "error",
    );
    expect(describeSessionStatus({ status: "stopped", endReason: "terminated" }).tone).toBe(
      "error",
    );
    expect(describeSessionStatus({ status: "stopped" })).toEqual({
      tone: "neutral",
      label: "Stopped",
    });
  });

  it("capitalizes unknown statuses and falls back to Unknown for empty", () => {
    expect(describeSessionStatus({ status: "weird" })).toEqual({
      tone: "neutral",
      label: "Weird",
    });
    expect(describeSessionStatus({ status: "" })).toEqual({ tone: "neutral", label: "Unknown" });
  });
});

describe("isActiveTone / isActiveSession", () => {
  it("treats running/idle/pending as active and the rest as inactive", () => {
    expect(isActiveTone("running")).toBe(true);
    expect(isActiveTone("idle")).toBe(true);
    expect(isActiveTone("pending")).toBe(true);
    expect(isActiveTone("success")).toBe(false);
    expect(isActiveTone("error")).toBe(false);
    expect(isActiveTone("paused")).toBe(false);
    expect(isActiveTone("neutral")).toBe(false);
    expect(isActiveSession(makeSession({ id: "a", status: "running" }))).toBe(true);
    expect(isActiveSession(makeSession({ id: "b", status: "completed" }))).toBe(false);
  });
});

describe("buildStatusChips", () => {
  it("always starts with All and only includes present tones, in tone order", () => {
    const sessions = [
      makeSession({ id: "a", status: "running" }),
      makeSession({ id: "b", status: "completed" }),
      makeSession({ id: "c", status: "failed" }),
      makeSession({ id: "d", status: "running" }),
    ];
    const chips = buildStatusChips(sessions);
    expect(chips[0]).toEqual({ value: "all", label: "All", count: 4 });
    expect(chips.slice(1).map((c) => c.value)).toEqual(["running", "success", "error"]);
    expect(chips.find((c) => c.value === "running")?.count).toBe(2);
  });

  it("returns just the All chip when there are no sessions", () => {
    expect(buildStatusChips([])).toEqual([{ value: "all", label: "All", count: 0 }]);
  });

  it("orders chips consistently with TONE_ORDER", () => {
    const sessions = TONE_ORDER.map((_, i) => makeSession({ id: `s-${i}` }));
    // All same tone here; just assert ordering invariant holds for a mixed set.
    const mixed = buildStatusChips([
      makeSession({ id: "p", status: "pending" }),
      makeSession({ id: "r", status: "running" }),
      makeSession({ id: "n", status: "stopped" }),
    ]);
    const order = mixed.slice(1).map((c) => c.value as string);
    expect(order).toEqual(["running", "pending", "neutral"]);
    expect(sessions.length).toBe(TONE_ORDER.length);
  });
});

describe("sessionMatchesQuery", () => {
  const session = makeSession({
    id: "sess-xyz",
    prompt: "Refactor the auth middleware",
    runtime: "copilot",
    taskId: "task-42",
  });

  it("matches everything for an empty/whitespace query", () => {
    expect(sessionMatchesQuery(session, "", "Local Dev")).toBe(true);
    expect(sessionMatchesQuery(session, "   ", "Local Dev")).toBe(true);
  });

  it("matches case-insensitively across prompt, runtime, id, task, and env name", () => {
    expect(sessionMatchesQuery(session, "AUTH", "Local Dev")).toBe(true);
    expect(sessionMatchesQuery(session, "copilot", "Local Dev")).toBe(true);
    expect(sessionMatchesQuery(session, "sess-xyz", "Local Dev")).toBe(true);
    expect(sessionMatchesQuery(session, "task-42", "Local Dev")).toBe(true);
    expect(sessionMatchesQuery(session, "local", "Local Dev")).toBe(true);
    expect(sessionMatchesQuery(session, "nonexistent", "Local Dev")).toBe(false);
  });
});

describe("filterSessions", () => {
  const sessions = [
    makeSession({ id: "a", status: "running", environmentId: "env-1", prompt: "alpha" }),
    makeSession({ id: "b", status: "completed", environmentId: "env-2", prompt: "beta" }),
    makeSession({ id: "c", status: "failed", environmentId: "env-1", prompt: "gamma" }),
  ];
  const names = new Map([
    ["env-1", "Local Dev"],
    ["env-2", "Docker"],
  ]);

  it("returns all sessions when status is all and query empty", () => {
    expect(filterSessions(sessions, "all", "", names)).toHaveLength(3);
  });

  it("filters by status tone", () => {
    const running = filterSessions(sessions, "running", "", names);
    expect(running.map((s) => s.id)).toEqual(["a"]);
  });

  it("combines tone filter and query", () => {
    expect(filterSessions(sessions, "error", "gamma", names).map((s) => s.id)).toEqual(["c"]);
    expect(filterSessions(sessions, "error", "alpha", names)).toHaveLength(0);
  });

  it("falls back to env id for query matching when name is unknown", () => {
    const orphan = [makeSession({ id: "z", environmentId: "env-gone", prompt: "x" })];
    expect(filterSessions(orphan, "all", "env-gone", new Map())).toHaveLength(1);
  });
});

describe("groupSessionsByEnvironment", () => {
  const environments = [
    makeEnv({ id: "env-1", displayName: "Local Dev" }),
    makeEnv({ id: "env-2", displayName: "Docker" }),
  ];

  it("groups sessions by environment with newest-first ordering inside a group", () => {
    const sessions = [
      makeSession({ id: "old", environmentId: "env-1", startedAt: "2026-02-26T08:00:00Z" }),
      makeSession({ id: "new", environmentId: "env-1", startedAt: "2026-02-27T08:00:00Z" }),
    ];
    const groups = groupSessionsByEnvironment(sessions, environments);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["new", "old"]);
    expect(groups[0].environment?.displayName).toBe("Local Dev");
  });

  it("orders groups with active sessions first, then by recency", () => {
    const sessions = [
      // env-2: only completed (inactive), most recent overall
      makeSession({
        id: "done",
        environmentId: "env-2",
        status: "completed",
        startedAt: "2026-02-27T10:00:00Z",
      }),
      // env-1: has a running session, older
      makeSession({
        id: "live",
        environmentId: "env-1",
        status: "running",
        startedAt: "2026-02-27T09:00:00Z",
      }),
    ];
    const groups = groupSessionsByEnvironment(sessions, environments);
    expect(groups.map((g) => g.environmentId)).toEqual(["env-1", "env-2"]);
    expect(groups[0].activeCount).toBe(1);
    expect(groups[1].activeCount).toBe(0);
  });

  it("keeps a group for an environment that no longer exists", () => {
    const sessions = [makeSession({ id: "orphan", environmentId: "env-gone" })];
    const groups = groupSessionsByEnvironment(sessions, environments);
    expect(groups).toHaveLength(1);
    expect(groups[0].environment).toBeUndefined();
    expect(groups[0].environmentId).toBe("env-gone");
  });

  it("tie-breaks groups with equal recency by environment name", () => {
    const ts = "2026-02-27T08:00:00Z";
    const sessions = [
      makeSession({ id: "z", environmentId: "env-2", status: "completed", startedAt: ts }),
      makeSession({ id: "a", environmentId: "env-1", status: "completed", startedAt: ts }),
    ];
    const groups = groupSessionsByEnvironment(sessions, environments);
    // Docker (env-2) sorts before Local Dev (env-1) alphabetically.
    expect(groups.map((g) => g.environment?.displayName)).toEqual(["Docker", "Local Dev"]);
  });

  it("returns an empty array for no sessions", () => {
    expect(groupSessionsByEnvironment([], environments)).toEqual([]);
  });
});
