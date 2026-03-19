import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { findingTools } from "./finding.js";

type GrackleClient = Client<typeof grackle.Grackle>;

/** Look up a tool definition by name from the findingTools array. */
const getTool = (name: string) => findingTools.find((t) => t.name === name)!;

describe("finding_list", () => {
  const tool = getTool("finding_list");

  /** Verify queryFindings is called with correct args and response shape is mapped correctly. */
  test("happy path with full args", async () => {
    const mockClient = {
      queryFindings: vi.fn().mockResolvedValue({
        findings: [
          {
            id: "f-1",
            workspaceId: "p-1",
            taskId: "t-1",
            sessionId: "s-1",
            category: "bug",
            title: "Null pointer",
            content: "Found a null pointer dereference",
            tags: ["t1"],
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { workspaceId: "p-1", category: "bug", tag: "t1", limit: 10 },
      mockClient,
    );

    expect(mockClient.queryFindings).toHaveBeenCalledWith({
      workspaceId: "p-1",
      categories: ["bug"],
      tags: ["t1"],
      limit: 10,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      id: "f-1",
      workspaceId: "p-1",
      taskId: "t-1",
      sessionId: "s-1",
      category: "bug",
      title: "Null pointer",
      content: "Found a null pointer dereference",
      tags: ["t1"],
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(result.isError).toBeUndefined();
  });

  /** Verify optional args default to empty arrays and zero limit. */
  test("happy path with minimal args — defaults applied", async () => {
    const mockClient = {
      queryFindings: vi.fn().mockResolvedValue({ findings: [] }),
    } as unknown as GrackleClient;

    const result = await tool.handler({ workspaceId: "p-1" }, mockClient);

    expect(mockClient.queryFindings).toHaveBeenCalledWith({
      workspaceId: "p-1",
      categories: [],
      tags: [],
      limit: 0,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([]);
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      queryFindings: vi.fn().mockRejectedValue(
        new ConnectError("project not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler({ workspaceId: "p-missing" }, mockClient);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("project not found");
    expect(parsed.code).toBe("NOT_FOUND");
  });
});

describe("finding_post", () => {
  const tool = getTool("finding_post");

  /** Verify postFinding is called with full args and response is serialized correctly. */
  test("happy path with full args", async () => {
    const mockClient = {
      postFinding: vi.fn().mockResolvedValue({
        id: "f-2",
        workspaceId: "p-1",
        category: "insight",
        title: "Performance improvement",
        content: "Caching reduces latency by 40%",
        tags: ["t1"],
        createdAt: "2026-02-01T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      {
        workspaceId: "p-1",
        title: "Performance improvement",
        category: "insight",
        content: "Caching reduces latency by 40%",
        tags: ["t1"],
      },
      mockClient,
    );

    expect(mockClient.postFinding).toHaveBeenCalledWith({
      workspaceId: "p-1",
      title: "Performance improvement",
      category: "insight",
      content: "Caching reduces latency by 40%",
      tags: ["t1"],
      taskId: "",
      sessionId: "",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      id: "f-2",
      workspaceId: "p-1",
      category: "insight",
      title: "Performance improvement",
      content: "Caching reduces latency by 40%",
      tags: ["t1"],
      createdAt: "2026-02-01T00:00:00Z",
    });
    expect(result.isError).toBeUndefined();
  });

  /** Verify optional fields default to empty string/array when omitted. */
  test("happy path with minimal args — optional fields default", async () => {
    const mockClient = {
      postFinding: vi.fn().mockResolvedValue({
        id: "f-3",
        workspaceId: "p-1",
        category: "",
        title: "Minimal finding",
        content: "",
        tags: [],
        createdAt: "2026-02-01T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { workspaceId: "p-1", title: "Minimal finding" },
      mockClient,
    );

    expect(mockClient.postFinding).toHaveBeenCalledWith({
      workspaceId: "p-1",
      title: "Minimal finding",
      category: "",
      content: "",
      tags: [],
      taskId: "",
      sessionId: "",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("f-3");
    expect(parsed.tags).toEqual([]);
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      postFinding: vi.fn().mockRejectedValue(
        new ConnectError("project not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { workspaceId: "p-missing", title: "Oops" },
      mockClient,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("project not found");
    expect(parsed.code).toBe("NOT_FOUND");
  });

  /** Verify scoped AuthContext provides taskId and sessionId. */
  test("with scoped AuthContext uses taskId and taskSessionId", async () => {
    const mockClient = {
      postFinding: vi.fn().mockResolvedValue({
        id: "f-4",
        workspaceId: "p-1",
        category: "bug",
        title: "Scoped finding",
        content: "Details",
        tags: [],
        createdAt: "2026-03-01T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    await tool.handler(
      { workspaceId: "p-1", title: "Scoped finding" },
      mockClient,
      { type: "scoped", taskId: "task-42", workspaceId: "p-1", personaId: "per-1", taskSessionId: "sess-99" },
    );

    expect(mockClient.postFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-42",
        sessionId: "sess-99",
      }),
    );
  });

  /** Verify api-key AuthContext uses empty strings for taskId and sessionId. */
  test("with api-key AuthContext uses empty strings", async () => {
    const mockClient = {
      postFinding: vi.fn().mockResolvedValue({
        id: "f-5",
        workspaceId: "p-1",
        category: "",
        title: "API key finding",
        content: "",
        tags: [],
        createdAt: "2026-03-01T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    await tool.handler(
      { workspaceId: "p-1", title: "API key finding" },
      mockClient,
      { type: "api-key" },
    );

    expect(mockClient.postFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "",
        sessionId: "",
      }),
    );
  });
});
