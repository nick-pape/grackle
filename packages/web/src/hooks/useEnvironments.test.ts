// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ConnectError, Code } from "@connectrpc/connect";
import { useEnvironments } from "./useEnvironments.js";

// ---------------------------------------------------------------------------
// Mock grackleClient
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listEnvironments: vi.fn(),
  addEnvironment: vi.fn(),
  updateEnvironment: vi.fn(),
  provisionEnvironment: vi.fn(),
  stopEnvironment: vi.fn(),
  removeEnvironment: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  coreClient: mockClient,
}));

vi.mock("./proto-converters.js", () => ({
  protoToEnvironment: (x: unknown) => x,
}));

vi.mock("@grackle-ai/web-components", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, warnBadPayload: vi.fn() };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function connectError(message: string): ConnectError {
  return new ConnectError(message, Code.Internal);
}

// ---------------------------------------------------------------------------
// Tests: loading state
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests: operationError
// ---------------------------------------------------------------------------

describe("useEnvironments — operationError", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockClient.listEnvironments.mockResolvedValue({ environments: [] });
  });

  it("starts with empty operationError", () => {
    const { result } = renderHook(() => useEnvironments());
    expect(result.current.operationError).toBe("");
  });

  it("sets operationError when addEnvironment rejects with ConnectError", async () => {
    mockClient.addEnvironment.mockRejectedValue(connectError("adapter not found"));
    const { result } = renderHook(() => useEnvironments());

    await act(async () => {
      await result.current.addEnvironment("test", "ssh");
    });

    expect(result.current.operationError).toContain("adapter not found");
  });

  it("sets operationError when stopEnvironment rejects", async () => {
    mockClient.stopEnvironment.mockRejectedValue(connectError("not running"));
    const { result } = renderHook(() => useEnvironments());

    await act(async () => {
      await result.current.stopEnvironment("env-1");
    });

    expect(result.current.operationError).toContain("not running");
  });

  it("sets operationError when removeEnvironment rejects", async () => {
    mockClient.removeEnvironment.mockRejectedValue(connectError("still provisioned"));
    const { result } = renderHook(() => useEnvironments());

    await act(async () => {
      await result.current.removeEnvironment("env-1");
    });

    expect(result.current.operationError).toContain("still provisioned");
  });

  it("sets operationError when updateEnvironment rejects", async () => {
    mockClient.updateEnvironment.mockRejectedValue(connectError("invalid config"));
    const { result } = renderHook(() => useEnvironments());

    await act(async () => {
      await result.current.updateEnvironment("env-1", { displayName: "new" });
    });

    expect(result.current.operationError).toContain("invalid config");
  });

  it("uses fallback message for non-ConnectError", async () => {
    mockClient.addEnvironment.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useEnvironments());

    await act(async () => {
      await result.current.addEnvironment("test", "ssh");
    });

    expect(result.current.operationError).toBe("Operation failed");
  });

  it("clears error when a new operation starts", async () => {
    mockClient.addEnvironment.mockRejectedValueOnce(connectError("first failure"));
    mockClient.addEnvironment.mockResolvedValueOnce({});
    const { result } = renderHook(() => useEnvironments());

    await act(async () => {
      await result.current.addEnvironment("test", "ssh");
    });
    expect(result.current.operationError).toContain("first failure");

    await act(async () => {
      await result.current.addEnvironment("test2", "ssh");
    });
    expect(result.current.operationError).toBe("");
  });

  it("clearOperationError resets to empty string", async () => {
    mockClient.stopEnvironment.mockRejectedValue(connectError("fail"));
    const { result } = renderHook(() => useEnvironments());

    await act(async () => {
      await result.current.stopEnvironment("env-1");
    });
    expect(result.current.operationError).toContain("fail");

    act(() => {
      result.current.clearOperationError();
    });
    expect(result.current.operationError).toBe("");
  });

  it("sets operationError when provisionEnvironment stream rejects", async () => {
    mockClient.provisionEnvironment.mockImplementation(() => {
      return {
        [Symbol.asyncIterator](): AsyncIterator<unknown> {
          return {
            next: () => Promise.reject(connectError("provision denied")),
          };
        },
      };
    });
    const { result } = renderHook(() => useEnvironments());

    await act(async () => {
      await result.current.provisionEnvironment("env-1");
    });

    expect(result.current.operationError).toContain("provision denied");
  });

  it("does not set operationError when loadEnvironments rejects", async () => {
    mockClient.listEnvironments.mockRejectedValue(connectError("server down"));
    const { result } = renderHook(() => useEnvironments());

    await act(async () => {
      await result.current.loadEnvironments();
    });

    expect(result.current.operationError).toBe("");
  });
});
