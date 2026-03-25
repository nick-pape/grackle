// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useVersionStatus } from "./useVersionStatus.js";

// Mock the gRPC client
vi.mock("./useGrackleClient.js", () => ({
  grackleClient: {
    getVersionStatus: vi.fn(),
  },
}));

import { grackleClient } from "./useGrackleClient.js";
const mockGetVersionStatus = vi.mocked(grackleClient.getVersionStatus);

describe("useVersionStatus", () => {
  beforeEach(() => {
    mockGetVersionStatus.mockReset();
  });

  it("returns undefined initially", () => {
    mockGetVersionStatus.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useVersionStatus());
    expect(result.current).toBeUndefined();
  });

  it("returns version status after fetch", async () => {
    const mockStatus = {
      currentVersion: "0.76.0",
      latestVersion: "0.77.0",
      updateAvailable: true,
      isDocker: false,
    };
    mockGetVersionStatus.mockResolvedValueOnce(mockStatus as never);

    const { result } = renderHook(() => useVersionStatus());

    await waitFor(() => {
      expect(result.current).toEqual(mockStatus);
    });
  });

  it("handles errors gracefully", async () => {
    mockGetVersionStatus.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useVersionStatus());

    // Wait a tick for the effect to settle
    await waitFor(() => {
      expect(mockGetVersionStatus).toHaveBeenCalled();
    });

    expect(result.current).toBeUndefined();
  });
});
