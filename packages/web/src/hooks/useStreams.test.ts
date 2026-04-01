// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStreams } from "./useStreams.js";

// ---------------------------------------------------------------------------
// Mock grackleClient
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listStreams: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  coreClient: mockClient,
}));

vi.mock("./proto-converters.js", () => ({
  protoToStream: (x: unknown) => x,
}));

vi.mock("@grackle-ai/web-components", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, warnBadPayload: vi.fn() };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useStreams initial state", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("starts with empty streams array", () => {
    const { result } = renderHook(() => useStreams());
    expect(result.current.streams).toEqual([]);
  });

  it("streamsLoading starts false", () => {
    const { result } = renderHook(() => useStreams());
    expect(result.current.streamsLoading).toBe(false);
  });

  it("streamsLoadedOnce starts false", () => {
    const { result } = renderHook(() => useStreams());
    expect(result.current.streamsLoadedOnce).toBe(false);
  });
});

describe("useStreams.loadStreams", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls coreClient.listStreams and populates streams", async () => {
    const mockStream = { id: "s1", name: "test-stream", subscriberCount: 2, messageBufferDepth: 0, subscribers: [] };
    mockClient.listStreams.mockResolvedValueOnce({ streams: [mockStream] });

    const { result } = renderHook(() => useStreams());

    await act(async () => { await result.current.loadStreams(); });

    expect(mockClient.listStreams).toHaveBeenCalledWith({});
    expect(result.current.streams).toHaveLength(1);
    expect(result.current.streams[0]).toEqual(mockStream);
  });

  it("silently swallows errors", async () => {
    mockClient.listStreams.mockRejectedValueOnce(new Error("network error"));
    const { result } = renderHook(() => useStreams());

    await act(async () => { await result.current.loadStreams(); });

    expect(result.current.streams).toEqual([]);
  });

  it("sets streamsLoadedOnce to true after successful load", async () => {
    mockClient.listStreams.mockResolvedValueOnce({ streams: [] });
    const { result } = renderHook(() => useStreams());

    await act(async () => { await result.current.loadStreams(); });

    expect(result.current.streamsLoadedOnce).toBe(true);
  });

  it("sets streamsLoadedOnce to true even after an error", async () => {
    mockClient.listStreams.mockRejectedValueOnce(new Error("network error"));
    const { result } = renderHook(() => useStreams());

    await act(async () => { await result.current.loadStreams(); });

    expect(result.current.streamsLoadedOnce).toBe(true);
  });

  it("streamsLoading flips true then false", async () => {
    let resolvePromise!: (v: unknown) => void;
    mockClient.listStreams.mockReturnValueOnce(new Promise((resolve) => { resolvePromise = resolve; }));

    const { result } = renderHook(() => useStreams());

    act(() => { result.current.loadStreams().catch(() => {}); });
    expect(result.current.streamsLoading).toBe(true);

    await act(async () => { resolvePromise({ streams: [] }); });
    await waitFor(() => { expect(result.current.streamsLoading).toBe(false); });
  });
});

describe("useStreams.handleEvent", () => {
  it("returns false for all events (no stream domain events exist)", () => {
    const { result } = renderHook(() => useStreams());
    const event = { id: "e1", type: "stream.created", timestamp: "2026-01-01T00:00:00Z", payload: {} };
    expect(result.current.handleEvent(event)).toBe(false);
  });
});

describe("useStreams.domainHook", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("onConnect calls loadStreams", async () => {
    mockClient.listStreams.mockResolvedValueOnce({ streams: [] });
    const { result } = renderHook(() => useStreams());

    await act(async () => { await result.current.domainHook.onConnect(); });

    expect(mockClient.listStreams).toHaveBeenCalledTimes(1);
  });

  it("onDisconnect clears streams", async () => {
    const mockStream = { id: "s1", name: "test-stream", subscriberCount: 1, messageBufferDepth: 0, subscribers: [] };
    mockClient.listStreams.mockResolvedValueOnce({ streams: [mockStream] });
    const { result } = renderHook(() => useStreams());

    await act(async () => { await result.current.loadStreams(); });
    expect(result.current.streams).toHaveLength(1);

    act(() => { result.current.domainHook.onDisconnect(); });
    expect(result.current.streams).toEqual([]);
  });

  it("handleEvent returns false for unknown events", () => {
    const { result } = renderHook(() => useStreams());
    const event = { id: "e1", type: "unknown.noop", timestamp: "2026-01-01T00:00:00Z", payload: {} };
    expect(result.current.domainHook.handleEvent(event)).toBe(false);
  });
});
