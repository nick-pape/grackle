// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCredentials } from "./useCredentials.js";

// ---------------------------------------------------------------------------
// Mock grackleClient (vi.hoisted ensures the object exists before vi.mock runs)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  getCredentialProviders: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  coreClient: mockClient,
}));

// Mock proto-converters — identity passthrough for these tests
vi.mock("./proto-converters.js", () => ({
  protoToCredentialConfig: (c: unknown) => c,
}));

// Mock @grackle-ai/web-components helpers used by useCredentials
vi.mock("@grackle-ai/web-components", () => ({
  isCredentialProviderConfig: () => true,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(): { result: { current: ReturnType<typeof useCredentials> } } {
  const { result } = renderHook(() => useCredentials());
  return { result };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCredentials loading state", () => {
  it("credentialsLoading starts false", () => {
    const { result } = setup();
    expect(result.current.credentialsLoading).toBe(false);
  });

  it("credentialsLoading flips true on loadCredentials(), then false on resolve", async () => {
    mockClient.getCredentialProviders.mockResolvedValue({
      claude: "off",
      github: "off",
      copilot: "off",
      codex: "off",
      goose: "off",
    });

    const { result } = setup();

    act(() => {
      result.current.loadCredentials().catch(() => {});
    });

    expect(result.current.credentialsLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.credentialsLoading).toBe(false);
    });
  });

  it("credentialsLoading flips false on RPC error", async () => {
    mockClient.getCredentialProviders.mockRejectedValue(new Error("unavailable"));

    const { result } = setup();

    act(() => {
      result.current.loadCredentials().catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.credentialsLoading).toBe(false);
    });
  });
});
