// @vitest-environment jsdom
/**
 * Tests for the useDocuments live-docs store (#1396): tab open/dedup/close,
 * focus + badge behavior, watch lifecycle, and domain-event routing.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { GrackleEvent } from "@grackle-ai/web-components";
import { useDocuments } from "./useDocuments.js";

const ENV: string = "env-1";
const URI_A: string = "file:///repo/a.md";
const URI_B: string = "file:///repo/b.ts";

interface MockBridge {
  readResource: Mock;
  watchResource: Mock;
  unwatchResource: Mock;
}

function makeBridge(): MockBridge {
  return {
    readResource: vi.fn().mockResolvedValue({ data: "", encoding: "utf-8", contentType: "" }),
    watchResource: vi.fn().mockResolvedValue("watch-1"),
    unwatchResource: vi.fn().mockResolvedValue(undefined),
  };
}

/** Flush pending microtasks (the watch/read promises fired inside openDocument). */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useDocuments", () => {
  let bridge: ReturnType<typeof makeBridge>;

  beforeEach(() => {
    bridge = makeBridge();
  });

  it("opens a tab, activates it, opens the pane, and starts a watch + read", async () => {
    const { result } = renderHook(() => useDocuments(bridge));
    act(() => {
      result.current.openDocument({ environmentId: ENV, uri: URI_A });
    });
    await flush();

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0]).toMatchObject({ environmentId: ENV, uri: URI_A, title: "a.md" });
    expect(result.current.activeTabId).toBe(`${ENV} ${URI_A}`);
    expect(result.current.paneOpen).toBe(true);
    expect(bridge.watchResource).toHaveBeenCalledWith(ENV, URI_A);
    expect(bridge.readResource).toHaveBeenCalledWith(ENV, URI_A);
  });

  it("dedupes by environment + uri (no duplicate tab)", async () => {
    const { result } = renderHook(() => useDocuments(bridge));
    act(() => {
      result.current.openDocument({ environmentId: ENV, uri: URI_A });
      result.current.openDocument({ environmentId: ENV, uri: URI_A });
    });
    await flush();
    expect(result.current.tabs).toHaveLength(1);
    expect(bridge.watchResource).toHaveBeenCalledTimes(1);
  });

  it("badges (does not focus) a second doc opened in the background", async () => {
    const { result } = renderHook(() => useDocuments(bridge));
    act(() => {
      result.current.openDocument({ environmentId: ENV, uri: URI_A });
    });
    act(() => {
      result.current.openDocument({ environmentId: ENV, uri: URI_B });
    });
    await flush();
    // First tab stays active; second is unseen.
    expect(result.current.activeTabId).toBe(`${ENV} ${URI_A}`);
    expect(result.current.unseenTabIds).toContain(`${ENV} ${URI_B}`);
  });

  it("focuses when focus:true is requested", async () => {
    const { result } = renderHook(() => useDocuments(bridge));
    act(() => {
      result.current.openDocument({ environmentId: ENV, uri: URI_A });
    });
    act(() => {
      result.current.openDocument({ environmentId: ENV, uri: URI_B }, { focus: true });
    });
    await flush();
    expect(result.current.activeTabId).toBe(`${ENV} ${URI_B}`);
    expect(result.current.unseenTabIds).not.toContain(`${ENV} ${URI_B}`);
  });

  it("setActiveTab clears the unseen badge", async () => {
    const { result } = renderHook(() => useDocuments(bridge));
    act(() => {
      result.current.openDocument({ environmentId: ENV, uri: URI_A });
      result.current.openDocument({ environmentId: ENV, uri: URI_B });
    });
    act(() => {
      result.current.setActiveTab(`${ENV} ${URI_B}`);
    });
    await flush();
    expect(result.current.activeTabId).toBe(`${ENV} ${URI_B}`);
    expect(result.current.unseenTabIds).not.toContain(`${ENV} ${URI_B}`);
  });

  it("closeTab removes the tab, releases the watch, and activates the remaining tab", async () => {
    const { result } = renderHook(() => useDocuments(bridge));
    act(() => {
      result.current.openDocument({ environmentId: ENV, uri: URI_A });
    });
    await flush();
    act(() => {
      result.current.openDocument({ environmentId: ENV, uri: URI_B }, { focus: true });
    });
    await flush();
    act(() => {
      result.current.closeTab(`${ENV} ${URI_B}`);
    });
    await flush();
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].uri).toBe(URI_A);
    expect(result.current.activeTabId).toBe(`${ENV} ${URI_A}`);
    expect(bridge.unwatchResource).toHaveBeenCalled();
  });

  it("closing the last tab empties the pane", async () => {
    const { result } = renderHook(() => useDocuments(bridge));
    act(() => {
      result.current.openDocument({ environmentId: ENV, uri: URI_A });
    });
    await flush();
    act(() => {
      result.current.closeTab(`${ENV} ${URI_A}`);
    });
    await flush();
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.paneOpen).toBe(false);
    expect(result.current.activeTabId).toBeUndefined();
  });

  it("routes document.show into an unfocused tab and consumes the event", async () => {
    const { result } = renderHook(() => useDocuments(bridge));
    const event: GrackleEvent = {
      id: "e1",
      type: "document.show",
      timestamp: "2026-01-01T00:00:00Z",
      payload: { environmentId: ENV, uri: URI_A, sessionId: "s1" },
    };
    let consumed = false;
    act(() => {
      consumed = result.current.domainHook.handleEvent(event);
    });
    await flush();
    expect(consumed).toBe(true);
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe(`${ENV} ${URI_A}`); // first tab focuses
  });

  it("badges an inactive open tab on resource.changed but does not consume it", async () => {
    const { result } = renderHook(() => useDocuments(bridge));
    act(() => {
      result.current.openDocument({ environmentId: ENV, uri: URI_A }); // active
      result.current.openDocument({ environmentId: ENV, uri: URI_B }); // inactive (badged on open)
    });
    await flush();
    // Clear B's open-time badge: activate B (clears it), then go back to A so B is
    // open + inactive + unbadged before the resource.changed event.
    act(() => {
      result.current.setActiveTab(`${ENV} ${URI_B}`);
    });
    act(() => {
      result.current.setActiveTab(`${ENV} ${URI_A}`);
    });
    expect(result.current.unseenTabIds).not.toContain(`${ENV} ${URI_B}`);
    const changed: GrackleEvent = {
      id: "e2",
      type: "resource.changed",
      timestamp: "2026-01-01T00:00:00Z",
      payload: { environmentId: ENV, changes: [{ uri: URI_B, type: "modified" }] },
    };
    let consumed = true;
    act(() => {
      consumed = result.current.domainHook.handleEvent(changed);
    });
    expect(consumed).toBe(false); // observe-only; resource bridge still re-reads
    expect(result.current.unseenTabIds).toContain(`${ENV} ${URI_B}`);
  });

  it("ignores unknown events", () => {
    const { result } = renderHook(() => useDocuments(bridge));
    const event: GrackleEvent = {
      id: "e3",
      type: "task.created",
      timestamp: "2026-01-01T00:00:00Z",
      payload: {},
    };
    expect(result.current.domainHook.handleEvent(event)).toBe(false);
  });
});
