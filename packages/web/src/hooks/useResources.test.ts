// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { GrackleEvent } from "@grackle-ai/web-components";
import { useResources } from "./useResources.js";

// ---------------------------------------------------------------------------
// Mock grackleClient (coreClient)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  readResource: vi.fn(),
  watchResource: vi.fn(),
  unwatchResource: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  coreClient: mockClient,
}));

vi.mock("@grackle-ai/web-components", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, warnBadPayload: vi.fn() };
});

function changedEvent(payload: Record<string, unknown>): GrackleEvent {
  return { id: "1", type: "resource.changed", timestamp: "", payload };
}

describe("useResources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("readResource caches content retrievable via getResourceContent", async () => {
    mockClient.readResource.mockResolvedValueOnce({
      data: "# hi",
      encoding: "utf-8",
      contentType: "text/markdown",
    });
    const { result } = renderHook(() => useResources());

    let content;
    await act(async () => {
      content = await result.current.readResource("env-1", "file:///w/doc.md");
    });
    expect(content).toEqual({ data: "# hi", encoding: "utf-8", contentType: "text/markdown" });
    expect(result.current.getResourceContent("env-1", "file:///w/doc.md")?.data).toBe("# hi");
    expect(mockClient.readResource).toHaveBeenCalledWith({
      environmentId: "env-1",
      uri: "file:///w/doc.md",
      encoding: "",
    });
  });

  it("re-reads a cached file when a matching resource.changed event arrives", async () => {
    mockClient.readResource
      .mockResolvedValueOnce({ data: "v1", encoding: "utf-8", contentType: "" })
      .mockResolvedValueOnce({ data: "v2", encoding: "utf-8", contentType: "" });
    const { result } = renderHook(() => useResources());

    await act(async () => {
      await result.current.readResource("env-1", "file:///w/doc.md");
    });

    act(() => {
      result.current.domainHook.handleEvent(
        changedEvent({
          environmentId: "env-1",
          uri: "file:///w/doc.md",
          changes: [{ uri: "file:///w/doc.md", type: "updated" }],
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.getResourceContent("env-1", "file:///w/doc.md")?.data).toBe("v2");
    });
  });

  it("drops cached content when a watched file is deleted (type: deleted)", async () => {
    mockClient.readResource.mockResolvedValueOnce({
      data: "v1",
      encoding: "utf-8",
      contentType: "",
    });
    const { result } = renderHook(() => useResources());
    await act(async () => {
      await result.current.readResource("env-1", "file:///w/doc.md");
    });
    expect(result.current.getResourceContent("env-1", "file:///w/doc.md")?.data).toBe("v1");

    act(() => {
      result.current.domainHook.handleEvent(
        changedEvent({
          environmentId: "env-1",
          uri: "file:///w/doc.md",
          changes: [{ uri: "file:///w/doc.md", type: "deleted" }],
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.getResourceContent("env-1", "file:///w/doc.md")).toBeUndefined();
    });
    // A delete must not trigger a re-read of the now-missing file.
    expect(mockClient.readResource).toHaveBeenCalledTimes(1);
  });

  it("drops cached content when a re-read fails (file vanished after the event)", async () => {
    mockClient.readResource
      .mockResolvedValueOnce({ data: "v1", encoding: "utf-8", contentType: "" })
      .mockRejectedValueOnce(new Error("NotFound"));
    const { result } = renderHook(() => useResources());
    await act(async () => {
      await result.current.readResource("env-1", "file:///w/doc.md");
    });

    act(() => {
      result.current.domainHook.handleEvent(
        changedEvent({
          environmentId: "env-1",
          uri: "file:///w/doc.md",
          changes: [{ uri: "file:///w/doc.md", type: "updated" }],
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.getResourceContent("env-1", "file:///w/doc.md")).toBeUndefined();
    });
  });

  it("ignores changes to files that were never read (nothing displaying them)", async () => {
    const { result } = renderHook(() => useResources());
    act(() => {
      const handled = result.current.domainHook.handleEvent(
        changedEvent({
          environmentId: "env-1",
          uri: "file:///w/other.md",
          changes: [{ uri: "file:///w/other.md", type: "updated" }],
        }),
      );
      expect(handled).toBe(true);
    });
    expect(mockClient.readResource).not.toHaveBeenCalled();
  });

  it("does not consume unrelated event types", () => {
    const { result } = renderHook(() => useResources());
    expect(
      result.current.domainHook.handleEvent({
        id: "x",
        type: "task.created",
        timestamp: "",
        payload: {},
      }),
    ).toBe(false);
  });

  it("watchResource returns the server watch id; unwatchResource forwards it", async () => {
    mockClient.watchResource.mockResolvedValueOnce({ watchId: "wid-9" });
    mockClient.unwatchResource.mockResolvedValueOnce({});
    const { result } = renderHook(() => useResources());

    let id = "";
    await act(async () => {
      id = await result.current.watchResource("env-1", "file:///w/doc.md");
    });
    expect(id).toBe("wid-9");
    expect(mockClient.watchResource).toHaveBeenCalledWith({
      environmentId: "env-1",
      uri: "file:///w/doc.md",
      recursive: false,
    });

    await act(async () => {
      await result.current.unwatchResource("wid-9");
    });
    expect(mockClient.unwatchResource).toHaveBeenCalledWith({ watchId: "wid-9" });
  });

  it("onConnect re-reads cached files to resync after a reconnect", async () => {
    mockClient.readResource
      .mockResolvedValueOnce({ data: "v1", encoding: "utf-8", contentType: "" })
      .mockResolvedValueOnce({ data: "v2", encoding: "utf-8", contentType: "" });
    const { result } = renderHook(() => useResources());

    await act(async () => {
      await result.current.readResource("env-1", "file:///w/doc.md");
    });
    await act(async () => {
      await result.current.domainHook.onConnect();
    });
    expect(mockClient.readResource).toHaveBeenCalledTimes(2);
    expect(result.current.getResourceContent("env-1", "file:///w/doc.md")?.data).toBe("v2");
  });
});
