import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import type { AuthContext } from "@grackle-ai/auth";
import { workpadTools } from "./workpad.js";

type GrackleClient = Client<typeof grackle.GrackleOrchestration>;

/** Helper to find a tool definition by name. */
const getTool = (name: string) => workpadTools.find((t) => t.name === name)!;

describe("workpad_write", () => {
  const tool = getTool("workpad_write");

  test("happy path with scoped auth auto-fills taskId", async () => {
    const mockClient = {
      setWorkpad: vi.fn().mockResolvedValue({
        id: "t-1",
        title: "Fix bug",
        workpad: JSON.stringify({ status: "completed", summary: "Done", extra: {} }),
      }),
      getTask: vi.fn(),
    } as unknown as GrackleClient;

    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "t-1",
      workspaceId: "p-1",
      personaId: "per-1",
      taskSessionId: "sess-1",
    };

    const result = await tool.handler(
      { status: "completed", summary: "Done" },
      { orchestration: mockClient },
      scopedAuth,
    );

    expect(mockClient.setWorkpad).toHaveBeenCalledWith({
      taskId: "t-1",
      workpad: JSON.stringify({ status: "completed", summary: "Done" }),
    });
    expect(result.isError).toBeUndefined();
  });

  test("accepts explicit taskId for child task access", async () => {
    const mockClient = {
      setWorkpad: vi.fn().mockResolvedValue({ id: "child-1", workpad: "{}" }),
      getTask: vi.fn().mockResolvedValue({ id: "child-1", parentTaskId: "t-1" }),
    } as unknown as GrackleClient;

    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "t-1",
      workspaceId: "p-1",
      personaId: "per-1",
      taskSessionId: "sess-1",
    };

    const result = await tool.handler(
      { taskId: "child-1", status: "in progress", summary: "Working on it" },
      { orchestration: mockClient },
      scopedAuth,
    );

    expect(mockClient.setWorkpad).toHaveBeenCalledWith({
      taskId: "child-1",
      workpad: JSON.stringify({ status: "in progress", summary: "Working on it" }),
    });
    expect(result.isError).toBeUndefined();
  });

  test("returns error when no task context", async () => {
    const mockClient = {} as unknown as GrackleClient;

    const result = await tool.handler(
      { status: "done", summary: "Finished" },
      { orchestration: mockClient },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No task context");
  });

  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      setWorkpad: vi.fn().mockRejectedValue(
        new ConnectError("task not found", Code.NotFound),
      ),
      getTask: vi.fn(),
    } as unknown as GrackleClient;

    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "t-missing",
      workspaceId: "p-1",
      personaId: "per-1",
      taskSessionId: "sess-1",
    };

    const result = await tool.handler(
      { status: "done" }, { orchestration: mockClient },
      scopedAuth,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });

  test("includes extra field when provided", async () => {
    const mockClient = {
      setWorkpad: vi.fn().mockResolvedValue({ id: "t-1", workpad: "{}" }),
      getTask: vi.fn(),
    } as unknown as GrackleClient;

    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "t-1",
      workspaceId: "p-1",
      personaId: "per-1",
      taskSessionId: "sess-1",
    };

    await tool.handler(
      { status: "completed", summary: "PR opened", extra: { branch: "feat/x", pr: 42 } },
      { orchestration: mockClient },
      scopedAuth,
    );

    const call = (mockClient.setWorkpad as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const workpad = JSON.parse(call.workpad);
    expect(workpad.extra).toEqual({ branch: "feat/x", pr: 42 });
  });
});

describe("workpad_read", () => {
  const tool = getTool("workpad_read");

  test("happy path with scoped auth reads own task", async () => {
    const mockClient = {
      getTask: vi.fn().mockResolvedValue({
        id: "t-1",
        workpad: JSON.stringify({ status: "in progress", summary: "Working" }),
      }),
    } as unknown as GrackleClient;

    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "t-1",
      workspaceId: "p-1",
      personaId: "per-1",
      taskSessionId: "sess-1",
    };

    const result = await tool.handler({}, { orchestration: mockClient }, scopedAuth);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("in progress");
    expect(parsed.summary).toBe("Working");
    expect(result.isError).toBeUndefined();
  });

  test("reads child task workpad with explicit taskId", async () => {
    const mockClient = {
      getTask: vi.fn().mockImplementation(({ id }: { id: string }) => {
        if (id === "child-1") {
          return { id: "child-1", parentTaskId: "t-1", workpad: JSON.stringify({ status: "done" }) };
        }
        return { id, parentTaskId: "" };
      }),
    } as unknown as GrackleClient;

    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "t-1",
      workspaceId: "p-1",
      personaId: "per-1",
      taskSessionId: "sess-1",
    };

    const result = await tool.handler({ taskId: "child-1" }, { orchestration: mockClient }, scopedAuth);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("done");
  });

  test("returns empty object for task with no workpad", async () => {
    const mockClient = {
      getTask: vi.fn().mockResolvedValue({ id: "t-1", workpad: "" }),
    } as unknown as GrackleClient;

    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "t-1",
      workspaceId: "p-1",
      personaId: "per-1",
      taskSessionId: "sess-1",
    };

    const result = await tool.handler({}, { orchestration: mockClient }, scopedAuth);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({});
  });

  test("returns error when no task context", async () => {
    const mockClient = {} as unknown as GrackleClient;

    const result = await tool.handler({}, { orchestration: mockClient });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No task context");
  });

  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      getTask: vi.fn().mockRejectedValue(
        new ConnectError("task not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "t-missing",
      workspaceId: "p-1",
      personaId: "per-1",
      taskSessionId: "sess-1",
    };

    const result = await tool.handler({ taskId: "t-missing" }, { orchestration: mockClient }, scopedAuth);
    expect(result.isError).toBe(true);
  });
});
