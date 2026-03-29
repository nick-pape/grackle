// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEnvironments } from "./useEnvironments.js";

const mockClient = vi.hoisted(() => ({
  listEnvironments: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  grackleClient: mockClient,
}));

vi.mock("./proto-converters.js", () => ({
  protoToEnvironment: (x: unknown) => x,
}));

vi.mock("@grackle-ai/web-components", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, warnBadPayload: vi.fn() };
});

describe("useEnvironments loading state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("environmentsLoading starts false", () => {
    const { result } = renderHook(() => useEnvironments());
    expect(result.current.environmentsLoading).toBe(false);
  });

  it("environmentsLoading flips true on loadEnvironments, false on resolve", async () => {
    mockClient.listEnvironments.mockResolvedValueOnce({ environments: [] });
    const { result } = renderHook(() => useEnvironments());

    act(() => { result.current.loadEnvironments().catch(() => {}); });
    expect(result.current.environmentsLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.environmentsLoading).toBe(false);
    });
  });

  it("environmentsLoading flips false on RPC error", async () => {
    mockClient.listEnvironments.mockRejectedValueOnce(new Error("fail"));
    const { result } = renderHook(() => useEnvironments());

    act(() => { result.current.loadEnvironments().catch(() => {}); });

    await waitFor(() => {
      expect(result.current.environmentsLoading).toBe(false);
    });
  });
});
