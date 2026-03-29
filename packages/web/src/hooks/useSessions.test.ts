// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSessions } from "./useSessions.js";

// ---------------------------------------------------------------------------
// Mock grackleClient (vi.hoisted ensures the object exists before vi.mock runs)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listSessions: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  grackleClient: mockClient,
}));

// Mock proto-converters — identity passthrough for these tests
vi.mock("./proto-converters.js", () => ({
  protoToSession: (s: unknown) => s,
  protoToSessionEvent: (e: unknown) => e,
}));

// Mock @grackle-ai/web-components constants/helpers used by useSessions
vi.mock("@grackle-ai/web-components", () => ({
  MAX_EVENTS: 5000,
  isSessionEvent: () => true,
  mapEndReason: () => undefined,
  mapSessionStatus: (s: string) => s,
  warnBadPayload: () => false,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(): { result: { current: ReturnType<typeof useSessions> } } {
  const { result } = renderHook(() => useSessions());
  return { result };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSessions loading state", () => {
  it("sessionsLoading starts false", () => {
    const { result } = setup();
    expect(result.current.sessionsLoading).toBe(false);
  });

  it("sessionsLoading flips true on loadSessions(), then false on resolve", async () => {
    mockClient.listSessions.mockResolvedValue({ sessions: [] });

    const { result } = setup();

    act(() => {
      result.current.loadSessions().catch(() => {});
    });

    expect(result.current.sessionsLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.sessionsLoading).toBe(false);
    });
  });

  it("sessionsLoading flips false on RPC error", async () => {
    mockClient.listSessions.mockRejectedValue(new Error("unavailable"));

    const { result } = setup();

    act(() => {
      result.current.loadSessions().catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.sessionsLoading).toBe(false);
    });
  });
});
