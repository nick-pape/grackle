import { SessionStatus, type SessionSummary } from "@grackle-ai/ahp";
import { describe, expect, it } from "vitest";

import { SessionCache } from "./session-cache.js";

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    resource: "ahp-session:/x",
    provider: "claude-code",
    title: "Untitled",
    status: SessionStatus.Idle,
    createdAt: 1_000_000,
    modifiedAt: 1_000_001,
    ...overrides,
  };
}

describe("SessionCache", () => {
  it("starts empty", () => {
    expect(new SessionCache().list()).toEqual([]);
  });

  it("replaceAll overwrites wholesale, keyed by resource URI", () => {
    const cache = new SessionCache();
    cache.replaceAll([makeSummary({ resource: "ahp-session:/a" })]);
    cache.replaceAll([
      makeSummary({ resource: "ahp-session:/b", title: "B" }),
      makeSummary({ resource: "ahp-session:/c", title: "C" }),
    ]);
    const list = cache.list();
    expect(list).toHaveLength(2);
    expect(cache.get("ahp-session:/a")).toBeUndefined();
    expect(cache.get("ahp-session:/b")?.title).toBe("B");
    expect(cache.get("ahp-session:/c")?.title).toBe("C");
  });

  it("add inserts; duplicate add overwrites", () => {
    const cache = new SessionCache();
    cache.add("ahp-session:/a", makeSummary({ resource: "ahp-session:/a", title: "first" }));
    cache.add("ahp-session:/a", makeSummary({ resource: "ahp-session:/a", title: "second" }));
    expect(cache.get("ahp-session:/a")?.title).toBe("second");
    expect(cache.list()).toHaveLength(1);
  });

  it("remove drops the entry; missing-remove is a no-op", () => {
    const cache = new SessionCache();
    cache.add("ahp-session:/a", makeSummary({ resource: "ahp-session:/a" }));
    cache.remove("ahp-session:/a");
    expect(cache.get("ahp-session:/a")).toBeUndefined();
    expect(() => cache.remove("ahp-session:/missing")).not.toThrow();
  });

  it("applyChanges merges mutable fields without clobbering others", () => {
    const cache = new SessionCache();
    cache.add(
      "ahp-session:/a",
      makeSummary({ resource: "ahp-session:/a", title: "original", modifiedAt: 1000 }),
    );
    cache.applyChanges("ahp-session:/a", { status: SessionStatus.InProgress, modifiedAt: 2000 });
    const after = cache.get("ahp-session:/a");
    expect(after?.title).toBe("original");
    expect(after?.status).toBe(SessionStatus.InProgress);
    expect(after?.modifiedAt).toBe(2000);
  });

  it("applyChanges ignores identity fields (resource/provider/createdAt) per AHP spec", () => {
    const cache = new SessionCache();
    cache.add(
      "ahp-session:/a",
      makeSummary({
        resource: "ahp-session:/a",
        provider: "p-original",
        createdAt: 1000,
      }),
    );
    cache.applyChanges("ahp-session:/a", {
      resource: "ahp-session:/spoofed",
      provider: "p-spoof",
      createdAt: 9999,
      title: "renamed",
    });
    const after = cache.get("ahp-session:/a");
    expect(after?.resource).toBe("ahp-session:/a");
    expect(after?.provider).toBe("p-original");
    expect(after?.createdAt).toBe(1000);
    expect(after?.title).toBe("renamed");
  });

  it("applyChanges on unknown URI is a no-op", () => {
    const cache = new SessionCache();
    cache.applyChanges("ahp-session:/missing", { title: "ignored" });
    expect(cache.get("ahp-session:/missing")).toBeUndefined();
    expect(cache.list()).toEqual([]);
  });

  it("list returns a snapshot array (mutating it does not affect the cache)", () => {
    const cache = new SessionCache();
    cache.add("ahp-session:/a", makeSummary({ resource: "ahp-session:/a" }));
    const snapshot = cache.list();
    snapshot.length = 0;
    expect(cache.list()).toHaveLength(1);
  });

  it("clear drops every entry", () => {
    const cache = new SessionCache();
    cache.add("ahp-session:/a", makeSummary({ resource: "ahp-session:/a" }));
    cache.add("ahp-session:/b", makeSummary({ resource: "ahp-session:/b" }));
    cache.clear();
    expect(cache.list()).toEqual([]);
  });
});
