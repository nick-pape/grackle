import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import type { AuthContext } from "@grackle-ai/auth";
import { assertCallerIsAncestor, assertCallerIsSelfOrAncestor } from "./scope-enforcement.js";

type GrackleClient = Client<typeof grackle.GrackleOrchestration>;

/** Build a mock client whose getTask returns tasks from a lookup table. */
function createMockClient(tasks: Record<string, { parentTaskId: string }>): GrackleClient {
  return {
    getTask: vi.fn().mockImplementation(({ id }: { id: string }) => {
      const task = tasks[id];
      if (!task) {
        throw new ConnectError("not found", Code.NotFound);
      }
      return Promise.resolve({ id, ...task });
    }),
  } as unknown as GrackleClient;
}

const SCOPED_AUTH: AuthContext = {
  type: "scoped",
  taskId: "parent-task",
  workspaceId: "proj-1",
  personaId: "p-1",
  taskSessionId: "sess-1",
};

describe("assertCallerIsAncestor", () => {
  test("no-op for undefined auth", async () => {
    const client = createMockClient({});
    await expect(assertCallerIsAncestor(client, undefined, "any-task")).resolves.toBeUndefined();
    expect(client.getTask).not.toHaveBeenCalled();
  });

  test("no-op for api-key auth", async () => {
    const client = createMockClient({});
    await expect(assertCallerIsAncestor(client, { type: "api-key" }, "any-task")).resolves.toBeUndefined();
    expect(client.getTask).not.toHaveBeenCalled();
  });

  test("no-op for oauth auth", async () => {
    const client = createMockClient({});
    await expect(
      assertCallerIsAncestor(client, { type: "oauth", clientId: "c1" }, "any-task"),
    ).resolves.toBeUndefined();
    expect(client.getTask).not.toHaveBeenCalled();
  });

  test("passes when target's parent is the caller", async () => {
    const client = createMockClient({
      "child-task": { parentTaskId: "parent-task" },
    });
    await expect(assertCallerIsAncestor(client, SCOPED_AUTH, "child-task")).resolves.toBeUndefined();
  });

  test("passes when target's grandparent is the caller", async () => {
    const client = createMockClient({
      "grandchild": { parentTaskId: "child-task" },
      "child-task": { parentTaskId: "parent-task" },
    });
    await expect(assertCallerIsAncestor(client, SCOPED_AUTH, "grandchild")).resolves.toBeUndefined();
  });

  test("rejects when target is the caller's own task", async () => {
    const client = createMockClient({});
    await expect(
      assertCallerIsAncestor(client, SCOPED_AUTH, "parent-task"),
    ).rejects.toThrow(ConnectError);
    await expect(
      assertCallerIsAncestor(client, SCOPED_AUTH, "parent-task"),
    ).rejects.toThrow("Cannot operate on your own task");
  });

  test("rejects when target is not a descendant", async () => {
    const client = createMockClient({
      "unrelated-task": { parentTaskId: "other-root" },
      "other-root": { parentTaskId: "" },
    });
    await expect(
      assertCallerIsAncestor(client, SCOPED_AUTH, "unrelated-task"),
    ).rejects.toThrow(ConnectError);
    await expect(
      assertCallerIsAncestor(client, SCOPED_AUTH, "unrelated-task"),
    ).rejects.toThrow("not a descendant");
  });

  test("rejects when target is a root task (no parent)", async () => {
    const client = createMockClient({
      "root-task": { parentTaskId: "" },
    });
    await expect(
      assertCallerIsAncestor(client, SCOPED_AUTH, "root-task"),
    ).rejects.toThrow(ConnectError);
  });
});

describe("assertCallerIsSelfOrAncestor", () => {
  test("no-op for non-scoped auth", async () => {
    const client = createMockClient({});
    await expect(assertCallerIsSelfOrAncestor(client, undefined, "any-task")).resolves.toBeUndefined();
    await expect(assertCallerIsSelfOrAncestor(client, { type: "api-key" }, "any-task")).resolves.toBeUndefined();
  });

  test("allows self-access (target === caller task)", async () => {
    const client = createMockClient({});
    await expect(assertCallerIsSelfOrAncestor(client, SCOPED_AUTH, "parent-task")).resolves.toBeUndefined();
    expect(client.getTask).not.toHaveBeenCalled();
  });

  test("allows descendant access", async () => {
    const client = createMockClient({
      "child-task": { parentTaskId: "parent-task" },
    });
    await expect(assertCallerIsSelfOrAncestor(client, SCOPED_AUTH, "child-task")).resolves.toBeUndefined();
  });

  test("rejects unrelated task", async () => {
    const client = createMockClient({
      "unrelated-task": { parentTaskId: "other-root" },
      "other-root": { parentTaskId: "" },
    });
    await expect(
      assertCallerIsSelfOrAncestor(client, SCOPED_AUTH, "unrelated-task"),
    ).rejects.toThrow(ConnectError);
    await expect(
      assertCallerIsSelfOrAncestor(client, SCOPED_AUTH, "unrelated-task"),
    ).rejects.toThrow("not self or a descendant");
  });
});
