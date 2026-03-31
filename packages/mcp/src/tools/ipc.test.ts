import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import type { AuthContext } from "@grackle-ai/auth";
import { ipcTools } from "./ipc.js";

type GrackleClient = Client<typeof grackle.GrackleCore>;

/** Helper to find a tool definition by name. */
const getTool = (name: string) => ipcTools.find((t) => t.name === name)!;

/** Create a mock Grackle client with IPC-related methods stubbed. */
function createMockClient(): GrackleClient {
  return {
    spawnAgent: vi.fn(),
    waitForPipe: vi.fn(),
    writeToFd: vi.fn(),
    closeFd: vi.fn(),
    getSessionFds: vi.fn(),
    killAgent: vi.fn(),
    attachStream: vi.fn(),
  } as unknown as GrackleClient;
}

const SCOPED_AUTH: AuthContext = {
  type: "scoped",
  taskId: "t1",
  workspaceId: "w1",
  personaId: "p1",
  taskSessionId: "parent-sess",
};

describe("ipc_terminate", () => {
  test("resolves fd to target session and calls killAgent with graceful=true", async () => {
    const mockClient = createMockClient();
    (mockClient.getSessionFds as ReturnType<typeof vi.fn>).mockResolvedValue({
      fds: [
        {
          fd: 3,
          targetSessionId: "child-sess",
          owned: true,
          streamName: "pipe:child-sess",
          permission: "rw",
          deliveryMode: "async",
        },
      ],
    });
    (mockClient.killAgent as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await getTool("ipc_terminate").handler(
      { fd: 3 }, { core: mockClient },
      SCOPED_AUTH,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.targetSessionId).toBe("child-sess");
    expect(mockClient.killAgent).toHaveBeenCalledWith({ id: "child-sess", graceful: true });
  });

  test("returns error when fd not found", async () => {
    const mockClient = createMockClient();
    (mockClient.getSessionFds as ReturnType<typeof vi.fn>).mockResolvedValue({
      fds: [],
    });

    const result = await getTool("ipc_terminate").handler(
      { fd: 99 }, { core: mockClient },
      SCOPED_AUTH,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("fd 99");
  });

  test("returns error when fd has no target session", async () => {
    const mockClient = createMockClient();
    (mockClient.getSessionFds as ReturnType<typeof vi.fn>).mockResolvedValue({
      fds: [
        {
          fd: 3,
          targetSessionId: "",
          owned: true,
          streamName: "s",
          permission: "rw",
          deliveryMode: "detach",
        },
      ],
    });

    const result = await getTool("ipc_terminate").handler(
      { fd: 3 }, { core: mockClient },
      SCOPED_AUTH,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no target session");
  });

  test("returns error when fd is not owned", async () => {
    const mockClient = createMockClient();
    (mockClient.getSessionFds as ReturnType<typeof vi.fn>).mockResolvedValue({
      fds: [
        {
          fd: 3,
          targetSessionId: "parent-sess",
          owned: false,
          streamName: "lifecycle:parent-sess",
          permission: "rw",
          deliveryMode: "detach",
        },
      ],
    });

    const result = await getTool("ipc_terminate").handler(
      { fd: 3 }, { core: mockClient },
      SCOPED_AUTH,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not an owned child fd");
  });

  test("requires scoped auth", async () => {
    const mockClient = createMockClient();

    const result = await getTool("ipc_terminate").handler(
      { fd: 3 }, { core: mockClient },
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("scoped auth");
  });
});

describe("ipc_share_stream", () => {
  /** Build a mock fds response with a pipe fd (inherited) and a stream fd. */
  function makeFds(streamPermission: string = "rw") {
    return {
      fds: [
        {
          fd: 3,
          streamName: "pipe:child-sess",
          owned: false,
          targetSessionId: "parent-sess",
          permission: "rw",
          deliveryMode: "async",
        },
        {
          fd: 4,
          streamName: "my-stream",
          owned: true,
          targetSessionId: "",
          permission: streamPermission,
          deliveryMode: "async",
        },
      ],
    };
  }

  const CHILD_AUTH: AuthContext = {
    type: "scoped",
    taskId: "t1",
    workspaceId: "w1",
    personaId: "p1",
    taskSessionId: "child-sess",
  };

  test("happy path — attaches stream and sends pipe notification", async () => {
    const mockClient = createMockClient();
    (mockClient.getSessionFds as ReturnType<typeof vi.fn>).mockResolvedValue(makeFds());
    (mockClient.attachStream as ReturnType<typeof vi.fn>).mockResolvedValue({ fd: 7 });
    (mockClient.writeToFd as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await getTool("ipc_share_stream").handler({ fd: 4 }, { core: mockClient }, CHILD_AUTH);
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBeFalsy();
    expect(parsed.parentFd).toBe(7);
    expect(parsed.streamName).toBe("my-stream");
    expect(parsed.parentSessionId).toBe("parent-sess");

    expect(mockClient.attachStream).toHaveBeenCalledWith({
      sessionId: "child-sess",
      fd: 4,
      targetSessionId: "parent-sess",
      permission: "rw",
      deliveryMode: "async",
    });
    expect(mockClient.writeToFd).toHaveBeenCalledWith({
      sessionId: "child-sess",
      fd: 3,
      message: expect.stringContaining('[stream-ref] Shared stream "my-stream" — your fd: 7'),
    });
  });

  test("requires scoped auth", async () => {
    const mockClient = createMockClient();

    const result = await getTool("ipc_share_stream").handler({ fd: 4 }, { core: mockClient }, undefined);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("scoped auth");
  });

  test("returns error when no pipe fd found (no parent)", async () => {
    const mockClient = createMockClient();
    (mockClient.getSessionFds as ReturnType<typeof vi.fn>).mockResolvedValue({
      fds: [
        {
          fd: 4,
          streamName: "my-stream",
          owned: true,
          targetSessionId: "",
          permission: "rw",
          deliveryMode: "async",
        },
      ],
    });

    const result = await getTool("ipc_share_stream").handler({ fd: 4 }, { core: mockClient }, CHILD_AUTH);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no parent pipe");
  });

  test("returns error when parent has disconnected (empty targetSessionId)", async () => {
    const mockClient = createMockClient();
    (mockClient.getSessionFds as ReturnType<typeof vi.fn>).mockResolvedValue({
      fds: [
        {
          fd: 3,
          streamName: "pipe:child-sess",
          owned: false,
          targetSessionId: "",
          permission: "rw",
          deliveryMode: "async",
        },
        {
          fd: 4,
          streamName: "my-stream",
          owned: true,
          targetSessionId: "",
          permission: "rw",
          deliveryMode: "async",
        },
      ],
    });

    const result = await getTool("ipc_share_stream").handler({ fd: 4 }, { core: mockClient }, CHILD_AUTH);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("parent has disconnected");
  });

  test("returns error when stream fd not found", async () => {
    const mockClient = createMockClient();
    (mockClient.getSessionFds as ReturnType<typeof vi.fn>).mockResolvedValue(makeFds());

    const result = await getTool("ipc_share_stream").handler({ fd: 99 }, { core: mockClient }, CHILD_AUTH);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("fd 99 not found");
  });

  test("returns error when sharing the pipe fd itself", async () => {
    const mockClient = createMockClient();
    (mockClient.getSessionFds as ReturnType<typeof vi.fn>).mockResolvedValue(makeFds());

    // fd 3 is the pipe fd (streamName: "pipe:child-sess")
    const result = await getTool("ipc_share_stream").handler({ fd: 3 }, { core: mockClient }, CHILD_AUTH);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("pipe fd");
  });

  test("permission downgrade — child has rw, shares as r", async () => {
    const mockClient = createMockClient();
    (mockClient.getSessionFds as ReturnType<typeof vi.fn>).mockResolvedValue(makeFds("rw"));
    (mockClient.attachStream as ReturnType<typeof vi.fn>).mockResolvedValue({ fd: 8 });
    (mockClient.writeToFd as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await getTool("ipc_share_stream").handler(
      { fd: 4, permission: "r" },
      { core: mockClient },
      CHILD_AUTH,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBeFalsy();
    expect(parsed.parentFd).toBe(8);
    expect(mockClient.attachStream).toHaveBeenCalledWith(expect.objectContaining({ permission: "r" }));
  });

  test("permission escalation — attach throws PERMISSION_DENIED, returned as error", async () => {
    const mockClient = createMockClient();
    (mockClient.getSessionFds as ReturnType<typeof vi.fn>).mockResolvedValue(makeFds("r"));
    (mockClient.attachStream as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("permission denied", Code.PermissionDenied),
    );

    const result = await getTool("ipc_share_stream").handler(
      { fd: 4, permission: "rw" },
      { core: mockClient },
      CHILD_AUTH,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("PERMISSION_DENIED");
  });
});
