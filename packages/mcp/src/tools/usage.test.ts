import { describe, it, expect, vi } from "vitest";
import { usageTools } from "./usage.js";

const mockGetUsage = vi.fn();
const mockClient = { getUsage: mockGetUsage } as unknown as Parameters<(typeof usageTools)[0]["handler"]>[1];

describe("usage_get", () => {
  const tool = usageTools.find((t) => t.name === "usage_get")!;

  it("exists and is read-only", () => {
    expect(tool).toBeDefined();
    expect(tool.mutating).toBe(false);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("calls client.getUsage with scope and id", async () => {
    mockGetUsage.mockResolvedValue({
      inputTokens: 1000,
      outputTokens: 50,
      costUsd: 0.05,
      sessionCount: 2,
    });

    const result = await tool.handler(
      { scope: "task", id: "task-123" },
      mockClient,
    );

    expect(mockGetUsage).toHaveBeenCalledWith({ scope: "task", id: "task-123" });
    expect(result.content[0].type).toBe("text");
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.inputTokens).toBe(1000);
    expect(data.outputTokens).toBe(50);
    expect(data.costUsd).toBe(0.05);
    expect(data.sessionCount).toBe(2);
  });

  it("handles gRPC errors gracefully", async () => {
    const { ConnectError, Code } = await import("@connectrpc/connect");
    mockGetUsage.mockRejectedValue(new ConnectError("Not found", Code.NotFound));

    const result = await tool.handler(
      { scope: "session", id: "nonexistent" },
      mockClient,
    );

    expect(result.isError).toBe(true);
  });
});
