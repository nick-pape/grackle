// @vitest-environment jsdom
/**
 * Unit tests for the useAgents hook (#1447).
 *
 * Covers: environmentId forwarding in updateAgent, setHeartbeat dispatch
 * and re-fetch, and the domainHook contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAgents } from "./useAgents.js";
import type { GrackleEvent } from "@grackle-ai/web-components";

// ---------------------------------------------------------------------------
// Mock the gRPC client via vi.hoisted so it exists before vi.mock runs.
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listAgents: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  setAgentHeartbeat: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  orchestrationClient: mockClient,
}));

// proto-converters: identity passthrough — we only care about the hook wiring.
vi.mock("./proto-converters.js", () => ({
  protoToAgent: (p: unknown) => p,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_A = {
  id: "a1",
  name: "Agent Alpha",
  avatar: "🐦",
  primaryPersonaId: "p1",
  environmentId: "env-local",
};

function setup(): { result: { current: ReturnType<typeof useAgents> } } {
  return renderHook(() => useAgents());
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: listAgents returns one agent.
  mockClient.listAgents.mockResolvedValue({ agents: [AGENT_A] });
});

// ---------------------------------------------------------------------------
// loadAgents
// ---------------------------------------------------------------------------

describe("loadAgents", () => {
  it("populates the agents list on success", async () => {
    const { result } = setup();
    await act(() => result.current.loadAgents());
    expect(result.current.agents).toEqual([AGENT_A]);
  });

  it("leaves the list empty and does not throw on RPC error", async () => {
    mockClient.listAgents.mockRejectedValue(new Error("offline"));
    const { result } = setup();
    await act(() => result.current.loadAgents());
    expect(result.current.agents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateAgent — environmentId forwarding (#1447)
// ---------------------------------------------------------------------------

describe("updateAgent", () => {
  it("forwards environmentId to the gRPC client", async () => {
    const updated = { ...AGENT_A, environmentId: "env-remote" };
    mockClient.updateAgent.mockResolvedValue(updated);

    const { result } = setup();
    await act(() => result.current.updateAgent("a1", { environmentId: "env-remote" }));

    expect(mockClient.updateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a1", environmentId: "env-remote" }),
    );
  });

  it("passes undefined environmentId when not provided (preserves field)", async () => {
    const updated = { ...AGENT_A, name: "Agent Beta" };
    mockClient.updateAgent.mockResolvedValue(updated);

    const { result } = setup();
    await act(() => result.current.updateAgent("a1", { name: "Agent Beta" }));

    const call = mockClient.updateAgent.mock.calls[0][0] as Record<string, unknown>;
    // environmentId absent → proto3 optional treats it as "keep existing".
    expect(call.environmentId).toBeUndefined();
  });

  it("applies the optimistic update to the local agents list", async () => {
    const updated = { ...AGENT_A, name: "Renamed" };
    mockClient.updateAgent.mockResolvedValue(updated);
    mockClient.listAgents.mockResolvedValue({ agents: [AGENT_A] });

    const { result } = setup();
    await act(() => result.current.loadAgents());
    await act(() => result.current.updateAgent("a1", { name: "Renamed" }));

    expect(result.current.agents[0].name).toBe("Renamed");
  });
});

// ---------------------------------------------------------------------------
// setHeartbeat (#1447)
// ---------------------------------------------------------------------------

describe("setHeartbeat", () => {
  it("calls setAgentHeartbeat with the correct agentId and opts", async () => {
    mockClient.setAgentHeartbeat.mockResolvedValue({});
    mockClient.listAgents.mockResolvedValue({ agents: [AGENT_A] });

    const { result } = setup();
    await act(() =>
      result.current.setHeartbeat("a1", { cadence: "5m", rules: "check queue", enabled: true }),
    );

    expect(mockClient.setAgentHeartbeat).toHaveBeenCalledWith({
      agentId: "a1",
      cadence: "5m",
      rules: "check queue",
      enabled: true,
    });
  });

  it("triggers a loadAgents re-fetch after the RPC resolves", async () => {
    mockClient.setAgentHeartbeat.mockResolvedValue({});
    mockClient.listAgents.mockResolvedValue({ agents: [AGENT_A] });

    const { result } = setup();
    await act(() => result.current.setHeartbeat("a1", { enabled: false }));

    // One call from the loadAgents inside setHeartbeat.
    expect(mockClient.listAgents).toHaveBeenCalledTimes(1);
  });

  it("forwards partial opts (only enabled) without setting cadence/rules", async () => {
    mockClient.setAgentHeartbeat.mockResolvedValue({});
    mockClient.listAgents.mockResolvedValue({ agents: [] });

    const { result } = setup();
    await act(() => result.current.setHeartbeat("a1", { enabled: false }));

    const call = mockClient.setAgentHeartbeat.mock.calls[0][0] as Record<string, unknown>;
    expect(call.enabled).toBe(false);
    expect(call.cadence).toBeUndefined();
    expect(call.rules).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// domainHook — event routing
// ---------------------------------------------------------------------------

describe("domainHook", () => {
  it("re-fetches on agent.updated event", async () => {
    mockClient.listAgents.mockResolvedValue({ agents: [AGENT_A] });

    const { result } = setup();
    const event: GrackleEvent = {
      id: "ev1",
      type: "agent.updated",
      timestamp: "2026-01-01T00:00:00Z",
      payload: {},
    };
    act(() => {
      result.current.domainHook.handleEvent(event);
    });

    await waitFor(() => {
      expect(mockClient.listAgents).toHaveBeenCalled();
    });
  });

  it("re-fetches on agent.heartbeat.updated event", async () => {
    mockClient.listAgents.mockResolvedValue({ agents: [AGENT_A] });

    const { result } = setup();
    const event: GrackleEvent = {
      id: "ev2",
      type: "agent.heartbeat.updated",
      timestamp: "2026-01-01T00:00:00Z",
      payload: {},
    };
    act(() => {
      result.current.domainHook.handleEvent(event);
    });

    await waitFor(() => {
      expect(mockClient.listAgents).toHaveBeenCalled();
    });
  });

  it("does not re-fetch on unrelated events", () => {
    const { result } = setup();
    const event: GrackleEvent = {
      id: "ev3",
      type: "task.created",
      timestamp: "2026-01-01T00:00:00Z",
      payload: {},
    };
    act(() => {
      result.current.domainHook.handleEvent(event);
    });
    // listAgents not called (no loadAgents triggered by unrelated event).
    expect(mockClient.listAgents).not.toHaveBeenCalled();
  });
});
