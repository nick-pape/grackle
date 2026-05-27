// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockClient = vi.hoisted(() => ({
  listDockerContainers: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  coreClient: mockClient,
  orchestrationClient: mockClient,
  schedulingClient: mockClient,
  knowledgeClient: mockClient,
}));

vi.mock("./proto-converters.js", () => ({
  protoToDockerContainer: (x: unknown) => x,
}));

import { useDockerContainers } from "./useDockerContainers.js";

beforeEach(() => {
  mockClient.listDockerContainers.mockReset();
});

describe("useDockerContainers", () => {
  it("populates containers from the RPC result", async () => {
    mockClient.listDockerContainers.mockResolvedValue({
      containers: [
        { id: "abc", name: "demo-ext", image: "node:22", state: "running", status: "Up 1m" },
      ],
      error: "",
    });

    const { result } = renderHook(() => useDockerContainers());
    await act(async () => {
      await result.current.listDockerContainers();
    });

    expect(result.current.dockerContainers).toHaveLength(1);
    expect(result.current.dockerContainers[0]!.name).toBe("demo-ext");
    expect(result.current.dockerContainersError).toBe("");
  });

  it("captures a non-fatal error string from the RPC", async () => {
    mockClient.listDockerContainers.mockResolvedValue({
      containers: [],
      error: "docker: command not found",
    });

    const { result } = renderHook(() => useDockerContainers());
    await act(async () => {
      await result.current.listDockerContainers();
    });

    expect(result.current.dockerContainers).toHaveLength(0);
    expect(result.current.dockerContainersError).toContain("command not found");
  });

  it("sets an error message on RPC rejection so the UI can fall back to manual entry", async () => {
    mockClient.listDockerContainers.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useDockerContainers());
    await act(async () => {
      await result.current.listDockerContainers();
    });

    expect(result.current.dockerContainers).toEqual([]);
    expect(result.current.dockerContainersError).toContain("network down");
  });

  it("exposes a domainHook", () => {
    const { result } = renderHook(() => useDockerContainers());
    expect(result.current.domainHook).toBeDefined();
  });
});
