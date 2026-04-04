import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { workspaceTools } from "./workspace.js";

type GrackleClient = Client<typeof grackle.GrackleCore>;

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
            environmentId: "env-1",
            status: 1,
          },
        ],
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler({}, { core: mockClient });

    expect(mockClient.listWorkspaces).toHaveBeenCalledWith({ environmentId: "" });

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

    const result = await tool.handler({}, { core: mockClient });

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
        environmentId: "env-2",
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
        environmentId: "env-2",
      },
      { core: mockClient },
    );

    expect(mockClient.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Beta",
        description: "Second workspace",
        repoUrl: "https://github.com/org/beta",
        environmentId: "env-2",
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
        environmentId: "env-1",
        status: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler({ name: "Minimal", environmentId: "env-1" }, { core: mockClient });

    expect(mockClient.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Minimal",
        environmentId: "env-1",
        description: "",
        repoUrl: "",
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

    const result = await tool.handler({ name: "Dupe" }, { core: mockClient });

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
        environmentId: "env-1",
        status: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler({ workspaceId: "proj-1" }, { core: mockClient });

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

    const result = await tool.handler({ workspaceId: "proj-missing" }, { core: mockClient });

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
        environmentId: "env-1",
        status: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-03T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { workspaceId: "proj-1", name: "Alpha Renamed" },
      { core: mockClient },
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

  /** Verify budget fields are passed through when provided. */
  test("passes budget fields when provided", async () => {
    const mockClient = {
      updateWorkspace: vi.fn().mockResolvedValue({
        id: "proj-1",
        name: "Alpha",
        description: "First workspace",
        repoUrl: "https://github.com/org/alpha",
        environmentId: "env-1",
        status: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-03T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    await tool.handler(
      { workspaceId: "proj-1", tokenBudget: 100000, costBudgetMillicents: 2000 },
      { core: mockClient },
    );

    expect(mockClient.updateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "proj-1",
        tokenBudget: 100000,
        costBudgetMillicents: 2000,
      }),
    );
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
      { core: mockClient },
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

    const result = await tool.handler({ workspaceId: "proj-1" }, { core: mockClient });

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

    const result = await tool.handler({ workspaceId: "proj-missing" }, { core: mockClient });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });
});

describe("workspace_link_environment", () => {
  const tool = getTool("workspace_link_environment");

  test("happy path — links and returns workspace with linked IDs", async () => {
    const mockClient = {
      linkEnvironment: vi.fn().mockResolvedValue({
        id: "ws-1",
        name: "My Workspace",
        environmentId: "env-primary",
        linkedEnvironmentIds: ["env-2"],
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { workspaceId: "ws-1", environmentId: "env-2" },
      { core: mockClient },
    );

    expect(mockClient.linkEnvironment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      environmentId: "env-2",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.linkedEnvironmentIds).toEqual(["env-2"]);
    expect(result.isError).toBeUndefined();
  });

  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      linkEnvironment: vi.fn().mockRejectedValue(
        new ConnectError("Cannot link the primary environment", Code.InvalidArgument),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { workspaceId: "ws-1", environmentId: "env-primary" },
      { core: mockClient },
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("INVALID_ARGUMENT");
  });
});

/**
 * Regression tests for #1182: workspace management tools must have
 * group === "workspace" so the MCP server's scoped-auth workspaceId injection
 * (mcp-server.ts) skips them. These tools use workspaceId as the *target*
 * workspace to operate on, not as the agent's own workspace context.
 * If the group changes, the injection will overwrite the caller's workspaceId
 * with the agent's scoped workspace (always "default" for system orchestrators).
 */
describe("workspace tool group for scoped auth injection bypass", () => {
  const WORKSPACE_MANAGEMENT_TOOLS = [
    "workspace_get",
    "workspace_update",
    "workspace_archive",
    "workspace_link_environment",
    "workspace_unlink_environment",
  ] as const;

  for (const toolName of WORKSPACE_MANAGEMENT_TOOLS) {
    test(`${toolName} has group "workspace" (prevents workspaceId injection)`, () => {
      const tool = getTool(toolName);
      expect(tool.group).toBe("workspace");
    });
  }
});

describe("workspace_unlink_environment", () => {
  const tool = getTool("workspace_unlink_environment");

  test("happy path — unlinks and returns workspace", async () => {
    const mockClient = {
      unlinkEnvironment: vi.fn().mockResolvedValue({
        id: "ws-1",
        name: "My Workspace",
        environmentId: "env-primary",
        linkedEnvironmentIds: [],
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { workspaceId: "ws-1", environmentId: "env-2" },
      { core: mockClient },
    );

    expect(mockClient.unlinkEnvironment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      environmentId: "env-2",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.linkedEnvironmentIds).toEqual([]);
    expect(result.isError).toBeUndefined();
  });

  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      unlinkEnvironment: vi.fn().mockRejectedValue(
        new ConnectError("link not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { workspaceId: "ws-1", environmentId: "env-2" },
      { core: mockClient },
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });
});
