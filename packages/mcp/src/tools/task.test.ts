import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { taskTools } from "./task.js";

type GrackleClient = Client<typeof grackle.Grackle>;

/** Helper to find a tool definition by name. */
const getTool = (name: string) => taskTools.find((t) => t.name === name)!;

/** Create a mock Grackle client with all task-related methods stubbed. */
function createMockClient(): GrackleClient {
  return {
    listTasks: vi.fn(),
    createTask: vi.fn(),
    getTask: vi.fn(),
    updateTask: vi.fn(),
    startTask: vi.fn(),
    deleteTask: vi.fn(),
    completeTask: vi.fn(),
    resumeTask: vi.fn(),
    importGitHubIssues: vi.fn(),
  } as unknown as GrackleClient;
}

describe("task_list", () => {
  /** Should return task summaries with human-readable status. */
  test("happy path returns task list", async () => {
    const mockClient = createMockClient();
    (mockClient.listTasks as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: [
        {
          id: "t1",
          title: "Fix bug",
          status: 1,
          branch: "main",
          latestSessionId: "s1",
          sortOrder: 0,
          parentTaskId: "",
          depth: 0,
          childTaskIds: [],
        },
      ],
    });

    const result = await getTool("task_list").handler(
      { projectId: "proj-1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("t1");
    expect(parsed[0].title).toBe("Fix bug");
    expect(typeof parsed[0].status).toBe("string");
    expect(mockClient.listTasks).toHaveBeenCalledWith({
      projectId: "proj-1",
      search: "",
      status: "",
    });
  });

  /** Should pass search param through to client.listTasks. */
  test("passes search param to client", async () => {
    const mockClient = createMockClient();
    (mockClient.listTasks as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: [],
    });

    await getTool("task_list").handler(
      { projectId: "proj-1", search: "login bug" },
      mockClient,
    );

    expect(mockClient.listTasks).toHaveBeenCalledWith({
      projectId: "proj-1",
      search: "login bug",
      status: "",
    });
  });

  /** Should pass status param through to client.listTasks. */
  test("passes status param to client", async () => {
    const mockClient = createMockClient();
    (mockClient.listTasks as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: [],
    });

    await getTool("task_list").handler(
      { projectId: "proj-1", status: "in_progress" },
      mockClient,
    );

    expect(mockClient.listTasks).toHaveBeenCalledWith({
      projectId: "proj-1",
      search: "",
      status: "in_progress",
    });
  });

  /** Should send empty strings for optional params when not provided (backwards compat). */
  test("sends empty strings when optional params omitted", async () => {
    const mockClient = createMockClient();
    (mockClient.listTasks as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: [],
    });

    await getTool("task_list").handler(
      { projectId: "proj-1" },
      mockClient,
    );

    expect(mockClient.listTasks).toHaveBeenCalledWith({
      projectId: "proj-1",
      search: "",
      status: "",
    });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.listTasks as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("not found", Code.NotFound),
    );

    const result = await getTool("task_list").handler(
      { projectId: "no-such" },
      mockClient,
    );

    expect(result.isError).toBe(true);
  });
});

describe("task_create", () => {
  /** Should default parentTaskId to empty string and dependsOn to empty array. */
  test("happy path with defaults", async () => {
    const mockClient = createMockClient();
    (mockClient.createTask as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t2",
      title: "New task",
      status: 0,
    });

    const result = await getTool("task_create").handler(
      { projectId: "proj-1", title: "New task" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.id).toBe("t2");
    expect(mockClient.createTask).toHaveBeenCalledWith({
      projectId: "proj-1",
      title: "New task",
      description: "",
      dependsOn: [],
      parentTaskId: "",
    });
  });

  /** Should pass provided description and dependsOn. */
  test("passes description and dependsOn when provided", async () => {
    const mockClient = createMockClient();
    (mockClient.createTask as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t3",
      title: "Dep task",
      status: 0,
    });

    await getTool("task_create").handler(
      {
        projectId: "proj-1",
        title: "Dep task",
        description: "Details here",
        dependsOn: ["t1", "t2"],
      },
      mockClient,
    );

    expect(mockClient.createTask).toHaveBeenCalledWith({
      projectId: "proj-1",
      title: "Dep task",
      description: "Details here",
      dependsOn: ["t1", "t2"],
      parentTaskId: "",
    });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.createTask as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("invalid", Code.InvalidArgument),
    );

    const result = await getTool("task_create").handler(
      { projectId: "proj-1", title: "Bad" },
      mockClient,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("INVALID_ARGUMENT");
  });
});

describe("task_show", () => {
  /** Should call getTask and return the task with human-readable status. */
  test("happy path returns task details", async () => {
    const mockClient = createMockClient();
    (mockClient.getTask as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      title: "Fix bug",
      status: 2,
      description: "Fix the important bug",
    });

    const result = await getTool("task_show").handler(
      { taskId: "t1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.id).toBe("t1");
    // taskToJson converts status via taskStatusToString; if unrecognized it falls back to raw value
    expect(parsed).toHaveProperty("status");
    expect(mockClient.getTask).toHaveBeenCalledWith({ id: "t1" });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.getTask as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("not found", Code.NotFound),
    );

    const result = await getTool("task_show").handler(
      { taskId: "no-such" },
      mockClient,
    );

    expect(result.isError).toBe(true);
  });
});

describe("task_update", () => {
  /** Should convert status string to enum value via taskStatusToEnum. */
  test("converts status string to enum when provided", async () => {
    const mockClient = createMockClient();
    (mockClient.updateTask as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      title: "Updated",
      status: 2,
    });

    const result = await getTool("task_update").handler(
      { taskId: "t1", title: "Updated", status: "working" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.id).toBe("t1");
    // Verify the call was made — status should be a numeric enum value, not the string
    const callArgs = (mockClient.updateTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof callArgs.status).toBe("number");
    expect(callArgs.status).not.toBe(0);
  });

  /** Should send status 0 when no status is provided. */
  test("sends status 0 when no status provided", async () => {
    const mockClient = createMockClient();
    (mockClient.updateTask as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      title: "Just title",
      status: 1,
    });

    await getTool("task_update").handler(
      { taskId: "t1", title: "Just title" },
      mockClient,
    );

    const callArgs = (mockClient.updateTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.status).toBe(0);
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.updateTask as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("not found", Code.NotFound),
    );

    const result = await getTool("task_update").handler(
      { taskId: "no-such" },
      mockClient,
    );

    expect(result.isError).toBe(true);
  });
});

describe("task_start", () => {
  /** Should call startTask with all args and defaults. */
  test("happy path returns response", async () => {
    const mockClient = createMockClient();
    (mockClient.startTask as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: "s1",
      taskId: "t1",
    });

    const result = await getTool("task_start").handler(
      { taskId: "t1", runtime: "claude-code", model: "claude-sonnet-4-20250514" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.sessionId).toBe("s1");
    expect(mockClient.startTask).toHaveBeenCalledWith({
      taskId: "t1",
      runtime: "claude-code",
      model: "claude-sonnet-4-20250514",
      personaId: "",
      environmentId: "",
      notes: "",
    });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.startTask as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("precondition", Code.FailedPrecondition),
    );

    const result = await getTool("task_start").handler(
      { taskId: "t1" },
      mockClient,
    );

    expect(result.isError).toBe(true);
  });
});

describe("task_delete", () => {
  /** Should call deleteTask and return success. */
  test("happy path returns success", async () => {
    const mockClient = createMockClient();
    (mockClient.deleteTask as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await getTool("task_delete").handler(
      { taskId: "t1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(mockClient.deleteTask).toHaveBeenCalledWith({ id: "t1" });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.deleteTask as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("not found", Code.NotFound),
    );

    const result = await getTool("task_delete").handler(
      { taskId: "no-such" },
      mockClient,
    );

    expect(result.isError).toBe(true);
  });
});

describe("task_complete", () => {
  /** Should call completeTask and return the task with human-readable status. */
  test("happy path returns completed task", async () => {
    const mockClient = createMockClient();
    (mockClient.completeTask as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      title: "Done task",
      status: 3,
    });

    const result = await getTool("task_complete").handler(
      { taskId: "t1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.id).toBe("t1");
    expect(parsed).toHaveProperty("status");
    expect(mockClient.completeTask).toHaveBeenCalledWith({ id: "t1" });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.completeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("not found", Code.NotFound),
    );

    const result = await getTool("task_complete").handler(
      { taskId: "no-such" },
      mockClient,
    );

    expect(result.isError).toBe(true);
  });
});

describe("task_resume", () => {
  /** Should call resumeTask and return the session. */
  test("happy path returns session", async () => {
    const mockClient = createMockClient();
    (mockClient.resumeTask as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "s1",
      status: "running",
    });

    const result = await getTool("task_resume").handler(
      { taskId: "t1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.id).toBe("s1");
    expect(mockClient.resumeTask).toHaveBeenCalledWith({ id: "t1" });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.resumeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("not found", Code.NotFound),
    );

    const result = await getTool("task_resume").handler(
      { taskId: "no-such" },
      mockClient,
    );

    expect(result.isError).toBe(true);
  });
});

describe("task_import_github", () => {
  /** Should convert state string via issueStateToEnum and apply defaults. */
  test("happy path with defaults", async () => {
    const mockClient = createMockClient();
    (mockClient.importGitHubIssues as ReturnType<typeof vi.fn>).mockResolvedValue({
      imported: 3,
      linked: 1,
      skipped: 0,
    });

    const result = await getTool("task_import_github").handler(
      { projectId: "proj-1", repo: "octocat/hello-world" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.imported).toBe(3);
    expect(parsed.linked).toBe(1);
    expect(parsed.skipped).toBe(0);

    const callArgs = (mockClient.importGitHubIssues as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.projectId).toBe("proj-1");
    expect(callArgs.repo).toBe("octocat/hello-world");
    expect(callArgs.label).toBe("");
    // state should be a numeric enum value from issueStateToEnum("open")
    expect(typeof callArgs.state).toBe("number");
    expect(callArgs.environmentId).toBe("");
    expect(callArgs.includeComments).toBe(true);
  });

  /** Should pass explicit label and state. */
  test("passes explicit label and state", async () => {
    const mockClient = createMockClient();
    (mockClient.importGitHubIssues as ReturnType<typeof vi.fn>).mockResolvedValue({
      imported: 1,
      linked: 0,
      skipped: 2,
    });

    await getTool("task_import_github").handler(
      {
        projectId: "proj-1",
        repo: "octocat/hello-world",
        label: "bug",
        state: "closed",
        includeComments: false,
      },
      mockClient,
    );

    const callArgs = (mockClient.importGitHubIssues as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.label).toBe("bug");
    expect(typeof callArgs.state).toBe("number");
    expect(callArgs.includeComments).toBe(false);
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.importGitHubIssues as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("unavailable", Code.Unavailable),
    );

    const result = await getTool("task_import_github").handler(
      { projectId: "proj-1", repo: "octocat/hello-world" },
      mockClient,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("UNAVAILABLE");
  });
});
