// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFindings } from "./useFindings.js";

// ---------------------------------------------------------------------------
// Mock grackleClient (vi.hoisted ensures the object exists before vi.mock runs)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  queryFindings: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  grackleClient: mockClient,
}));

// Mock proto-converters — identity passthrough for these tests
vi.mock("./proto-converters.js", () => ({
  protoToFinding: (f: unknown) => f,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(): { result: { current: ReturnType<typeof useFindings> } } {
  const { result } = renderHook(() => useFindings());
  return { result };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useFindings loading state", () => {
  it("findingsLoading starts false", () => {
    const { result } = setup();
    expect(result.current.findingsLoading).toBe(false);
  });

  it("findingsLoading flips true on loadAllFindings(), then false on resolve", async () => {
    mockClient.queryFindings.mockResolvedValue({ findings: [] });

    const { result } = setup();

    act(() => {
      result.current.loadAllFindings().catch(() => {});
    });

    expect(result.current.findingsLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.findingsLoading).toBe(false);
    });
  });

  it("findingsLoading flips false on RPC error", async () => {
    mockClient.queryFindings.mockRejectedValue(new Error("unavailable"));

    const { result } = setup();

    act(() => {
      result.current.loadAllFindings().catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.findingsLoading).toBe(false);
    });
  });
});
