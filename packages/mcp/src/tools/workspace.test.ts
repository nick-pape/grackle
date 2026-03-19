import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { workspaceTools } from "./workspace.js";

type GrackleClient = Client<typeof grackle.Grackle>;

/** Look up a tool definition by name from the workspaceTools array. */
const getTool = (name: string) => workspaceTools.find((t) => t.name === name)!;

describe("workspace_list", () => {
  const tool = getTool("workspace_list");

  /** Verify listWorkspaces returns mapped workspace objects with stringified status. */
  test("happy path — returns workspaces with status string", async () => {
    const mockClient = {
      listWorkspaces: vi.fn().mockResolvedValue({
        workspaces: [
          {
            id: "proj-1",
            name: "Alpha",
            description: "First workspace",
            repoUrl: "https://github.com/org/alpha",
            defaultEnvironmentId: "env-1",
            status: 1,
          },
        ],
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler({}, mockClient);

    expect(mockClient.listWorkspaces).toHaveBeenCalledWith({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("proj-1");
    expect(parsed[0].name).toBe("Alpha");
    expect(parsed[0].status).toBe("active");
    expect(result.isError).toBeUndefined();
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      listWorkspaces: vi.fn().mockRejectedValue(
        new ConnectError("unavailable", Code.Unavailable),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler({}, mockClient);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("unavailable");
    expect(parsed.code).toBe("UNAVAILABLE");
  });
});

describe("workspace_create", () => {
  const tool = getTool("workspace_create");

  /** Verify createWorkspace is called with full args and response includes timestamps. */
  test("happy path with full args", async () => {
    const mockClient = {
      createWorkspace: vi.fn().mockResolvedValue({
        id: "proj-2",
        name: "Beta",
        description: "Second workspace",
        repoUrl: "https://github.com/org/beta",
        defaultEnvironmentId: "env-2",
        status: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      {
        name: "Beta",
        description: "Second workspace",
        repoUrl: "https://github.com/org/beta",
        defaultEnvironmentId: "env-2",
      },
      mockClient,
    );

    expect(mockClient.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Beta",
        description: "Second workspace",
        repoUrl: "https://github.com/org/beta",
        defaultEnvironmentId: "env-2",
      }),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("proj-2");
    expect(parsed.status).toBe("active");
    expect(parsed.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(result.isError).toBeUndefined();
  });

  /** Verify optional fields default to empty strings. */
  test("happy path with minimal args — defaults applied", async () => {
    const mockClient = {
      createWorkspace: vi.fn().mockResolvedValue({
        id: "proj-3",
        name: "Minimal",
        description: "",
        repoUrl: "",
        defaultEnvironmentId: "",
        status: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler({ name: "Minimal" }, mockClient);

    expect(mockClient.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Minimal",
        description: "",
        repoUrl: "",
        defaultEnvironmentId: "",
      }),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("unspecified");
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      createWorkspace: vi.fn().mockRejectedValue(
        new ConnectError("already exists", Code.AlreadyExists),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler({ name: "Dupe" }, mockClient);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("already exists");
    expect(parsed.code).toBe("ALREADY_EXISTS");
  });
});

describe("workspace_get", () => {
  const tool = getTool("workspace_get");

  /** Verify getWorkspace is called with the correct ID and response is serialized. */
  test("happy path", async () => {
    const mockClient = {
      getWorkspace: vi.fn().mockResolvedValue({
        id: "proj-1",
        name: "Alpha",
        description: "First workspace",
        repoUrl: "https://github.com/org/alpha",
        defaultEnvironmentId: "env-1",
        status: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler({ workspaceId: "proj-1" }, mockClient);

    expect(mockClient.getWorkspace).toHaveBeenCalledWith({ id: "proj-1" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("proj-1");
    expect(parsed.name).toBe("Alpha");
    expect(parsed.status).toBe("active");
    expect(result.isError).toBeUndefined();
  });

  /** Verify gRPC NotFound ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      getWorkspace: vi.fn().mockRejectedValue(
        new ConnectError("workspace not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler({ workspaceId: "proj-missing" }, mockClient);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("workspace not found");
    expect(parsed.code).toBe("NOT_FOUND");
  });
});

describe("workspace_update", () => {
  const tool = getTool("workspace_update");

  /** Verify updateWorkspace is called with correct args including optional fields. */
  test("happy path with partial update", async () => {
    const mockClient = {
      updateWorkspace: vi.fn().mockResolvedValue({
        id: "proj-1",
        name: "Alpha Renamed",
        description: "First workspace",
        repoUrl: "https://github.com/org/alpha",
        defaultEnvironmentId: "env-1",
        status: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-03T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { workspaceId: "proj-1", name: "Alpha Renamed" },
      mockClient,
    );

    expect(mockClient.updateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "proj-1",
        name: "Alpha Renamed",
      }),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("Alpha Renamed");
    expect(parsed.status).toBe("active");
    expect(result.isError).toBeUndefined();
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      updateWorkspace: vi.fn().mockRejectedValue(
        new ConnectError("workspace not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { workspaceId: "proj-missing", name: "Nope" },
      mockClient,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });
});

describe("workspace_archive", () => {
  const tool = getTool("workspace_archive");

  /** Verify archiveWorkspace is called and returns success. */
  test("happy path", async () => {
    const mockClient = {
      archiveWorkspace: vi.fn().mockResolvedValue({}),
    } as unknown as GrackleClient;

    const result = await tool.handler({ workspaceId: "proj-1" }, mockClient);

    expect(mockClient.archiveWorkspace).toHaveBeenCalledWith({ id: "proj-1" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ success: true });
    expect(result.isError).toBeUndefined();
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      archiveWorkspace: vi.fn().mockRejectedValue(
        new ConnectError("workspace not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler({ workspaceId: "proj-missing" }, mockClient);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });
});
