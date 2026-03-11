import { describe, it, expect, beforeEach } from "vitest";
import { addSession, getSession, removeSession, listAllSessions } from "./session-mgr.js";
import type { AgentSession } from "./runtimes/runtime.js";

function makeMockSession(id: string): AgentSession {
  return {
    id,
    runtimeName: "test",
    runtimeSessionId: `test-${id}`,
    status: "running",
    stream: async function* () {},
    sendInput: () => {},
    kill: () => {},
  };
}

describe("session-mgr", () => {
  beforeEach(() => {
    // Clean up any sessions from previous tests
    for (const session of listAllSessions()) {
      removeSession(session.id);
    }
  });

  it("add/get/remove/list roundtrip", () => {
    const session = makeMockSession("s1");
    addSession(session);

    expect(getSession("s1")).toBe(session);
    expect(listAllSessions()).toHaveLength(1);
    expect(listAllSessions()[0]).toBe(session);

    removeSession("s1");
    expect(getSession("s1")).toBeUndefined();
    expect(listAllSessions()).toHaveLength(0);
  });

  it("getSession returns undefined for unknown ID", () => {
    expect(getSession("nonexistent")).toBeUndefined();
  });

  it("removeSession is no-op for unknown ID", () => {
    // Should not throw
    removeSession("nonexistent");
    expect(listAllSessions()).toHaveLength(0);
  });

  it("duplicate ID overwrites the previous session", () => {
    const session1 = makeMockSession("dup");
    const session2 = makeMockSession("dup");

    addSession(session1);
    addSession(session2);

    expect(getSession("dup")).toBe(session2);
    expect(listAllSessions()).toHaveLength(1);
  });

  it("tracks multiple sessions independently", () => {
    const s1 = makeMockSession("a");
    const s2 = makeMockSession("b");
    const s3 = makeMockSession("c");

    addSession(s1);
    addSession(s2);
    addSession(s3);

    expect(listAllSessions()).toHaveLength(3);

    removeSession("b");
    expect(getSession("a")).toBe(s1);
    expect(getSession("b")).toBeUndefined();
    expect(getSession("c")).toBe(s3);
    expect(listAllSessions()).toHaveLength(2);
  });
});
