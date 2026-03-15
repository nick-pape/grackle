import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { projectTools } from "./project.js";

type GrackleClient = Client<typeof grackle.Grackle>;

/** Look up a tool definition by name from the projectTools array. */
const getTool = (name: string) => projectTools.find((t) => t.name === name)!;

describe("project_list", () => {
  const tool = getTool("project_list");

  /** Verify listProjects returns mapped project objects with stringified status. */
  test("happy path — returns projects with status string", async () => {
    const mockClient = {
      listProjects: vi.fn().mockResolvedValue({
        projects: [
          {
            id: "proj-1",
            name: "Alpha",
            description: "First project",
            repoUrl: "https://github.com/org/alpha",
            defaultEnvironmentId: "env-1",
            status: 1,
          },
        ],
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler({}, mockClient);

    expect(mockClient.listProjects).toHaveBeenCalledWith({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      id: "proj-1",
      name: "Alpha",
      description: "First project",
      repoUrl: "https://github.com/org/alpha",
      defaultEnvironmentId: "env-1",
      status: "active",
    });
    expect(result.isError).toBeUndefined();
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      listProjects: vi.fn().mockRejectedValue(
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

describe("project_create", () => {
  const tool = getTool("project_create");

  /** Verify createProject is called with full args and response includes timestamps. */
  test("happy path with full args", async () => {
    const mockClient = {
      createProject: vi.fn().mockResolvedValue({
        id: "proj-2",
        name: "Beta",
        description: "Second project",
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
        description: "Second project",
        repoUrl: "https://github.com/org/beta",
        defaultEnvironmentId: "env-2",
      },
      mockClient,
    );

    expect(mockClient.createProject).toHaveBeenCalledWith({
      name: "Beta",
      description: "Second project",
      repoUrl: "https://github.com/org/beta",
      defaultEnvironmentId: "env-2",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("proj-2");
    expect(parsed.status).toBe("active");
    expect(parsed.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(result.isError).toBeUndefined();
  });

  /** Verify optional fields default to empty strings. */
  test("happy path with minimal args — defaults applied", async () => {
    const mockClient = {
      createProject: vi.fn().mockResolvedValue({
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

    expect(mockClient.createProject).toHaveBeenCalledWith({
      name: "Minimal",
      description: "",
      repoUrl: "",
      defaultEnvironmentId: "",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("unspecified");
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      createProject: vi.fn().mockRejectedValue(
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

describe("project_get", () => {
  const tool = getTool("project_get");

  /** Verify getProject is called with the correct ID and response is serialized. */
  test("happy path", async () => {
    const mockClient = {
      getProject: vi.fn().mockResolvedValue({
        id: "proj-1",
        name: "Alpha",
        description: "First project",
        repoUrl: "https://github.com/org/alpha",
        defaultEnvironmentId: "env-1",
        status: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler({ projectId: "proj-1" }, mockClient);

    expect(mockClient.getProject).toHaveBeenCalledWith({ id: "proj-1" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("proj-1");
    expect(parsed.name).toBe("Alpha");
    expect(parsed.status).toBe("active");
    expect(result.isError).toBeUndefined();
  });

  /** Verify gRPC NotFound ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      getProject: vi.fn().mockRejectedValue(
        new ConnectError("project not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler({ projectId: "proj-missing" }, mockClient);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("project not found");
    expect(parsed.code).toBe("NOT_FOUND");
  });
});

describe("project_update", () => {
  const tool = getTool("project_update");

  /** Verify updateProject is called with correct args including optional fields. */
  test("happy path with partial update", async () => {
    const mockClient = {
      updateProject: vi.fn().mockResolvedValue({
        id: "proj-1",
        name: "Alpha Renamed",
        description: "First project",
        repoUrl: "https://github.com/org/alpha",
        defaultEnvironmentId: "env-1",
        status: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-03T00:00:00Z",
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { projectId: "proj-1", name: "Alpha Renamed" },
      mockClient,
    );

    expect(mockClient.updateProject).toHaveBeenCalledWith({
      id: "proj-1",
      name: "Alpha Renamed",
      description: undefined,
      repoUrl: undefined,
      defaultEnvironmentId: undefined,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("Alpha Renamed");
    expect(parsed.status).toBe("active");
    expect(result.isError).toBeUndefined();
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      updateProject: vi.fn().mockRejectedValue(
        new ConnectError("project not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { projectId: "proj-missing", name: "Nope" },
      mockClient,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });
});

describe("project_archive", () => {
  const tool = getTool("project_archive");

  /** Verify archiveProject is called and returns success. */
  test("happy path", async () => {
    const mockClient = {
      archiveProject: vi.fn().mockResolvedValue({}),
    } as unknown as GrackleClient;

    const result = await tool.handler({ projectId: "proj-1" }, mockClient);

    expect(mockClient.archiveProject).toHaveBeenCalledWith({ id: "proj-1" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ success: true });
    expect(result.isError).toBeUndefined();
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      archiveProject: vi.fn().mockRejectedValue(
        new ConnectError("project not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler({ projectId: "proj-missing" }, mockClient);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });
});
