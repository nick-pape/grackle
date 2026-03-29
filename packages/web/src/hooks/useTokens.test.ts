// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTokens } from "./useTokens.js";

// ---------------------------------------------------------------------------
// Mock grackleClient (vi.hoisted ensures the object exists before vi.mock runs)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listTokens: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  grackleClient: mockClient,
}));

// Mock proto-converters — identity passthrough for these tests
vi.mock("./proto-converters.js", () => ({
  protoToToken: (t: unknown) => t,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(): { result: { current: ReturnType<typeof useTokens> } } {
  const { result } = renderHook(() => useTokens());
  return { result };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTokens loading state", () => {
  it("tokensLoading starts false", () => {
    const { result } = setup();
    expect(result.current.tokensLoading).toBe(false);
  });

  it("tokensLoading flips true on loadTokens(), then false on resolve", async () => {
    mockClient.listTokens.mockResolvedValue({ tokens: [] });

    const { result } = setup();

    act(() => {
      result.current.loadTokens().catch(() => {});
    });

    expect(result.current.tokensLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.tokensLoading).toBe(false);
    });
  });

  it("tokensLoading flips false on RPC error", async () => {
    mockClient.listTokens.mockRejectedValue(new Error("unavailable"));

    const { result } = setup();

    act(() => {
      result.current.loadTokens().catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.tokensLoading).toBe(false);
    });
  });
});
