// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePersonas } from "./usePersonas.js";

// ---------------------------------------------------------------------------
// Mock grackleClient (vi.hoisted ensures the object exists before vi.mock runs)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listPersonas: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  orchestrationClient: mockClient,
}));

// Mock proto-converters — identity passthrough for these tests
vi.mock("./proto-converters.js", () => ({
  protoToPersona: (p: unknown) => p,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(): { result: { current: ReturnType<typeof usePersonas> } } {
  const { result } = renderHook(() => usePersonas());
  return { result };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePersonas loading state", () => {
  it("personasLoading starts false", () => {
    const { result } = setup();
    expect(result.current.personasLoading).toBe(false);
  });

  it("personasLoading flips true on loadPersonas(), then false on resolve", async () => {
    mockClient.listPersonas.mockResolvedValue({ personas: [] });

    const { result } = setup();

    act(() => {
      result.current.loadPersonas().catch(() => {});
    });

    expect(result.current.personasLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.personasLoading).toBe(false);
    });
  });

  it("personasLoading flips false on RPC error", async () => {
    mockClient.listPersonas.mockRejectedValue(new Error("unavailable"));

    const { result } = setup();

    act(() => {
      result.current.loadPersonas().catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.personasLoading).toBe(false);
    });
  });
});
