import { describe, test, expect, vi } from "vitest";
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
