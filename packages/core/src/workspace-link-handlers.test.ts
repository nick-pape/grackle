import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("./test-utils/mock-database.js");
  return createDatabaseMock();
});

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./event-bus.js", () => ({
  emit: vi.fn(),
}));

import type { ConnectRouter } from "@connectrpc/connect";
import { registerGrackleRoutes } from "./grpc-service.js";
import { workspaceStore, envRegistry, workspaceEnvironmentLinkStore } from "@grackle-ai/database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandlers(): Record<string, (...args: any[]) => any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handlers: Record<string, (...args: any[]) => any> = {};
  const fakeRouter = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service(_def: unknown, impl: Record<string, (...args: any[]) => any>) {
      handlers = impl;
    },
  } as unknown as ConnectRouter;
  registerGrackleRoutes(fakeRouter);
  return handlers;
}

/** Helper to build a minimal workspace row for mocking. */
function makeWorkspaceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ws-1",
    name: "Test Workspace",
    description: "",
    repoUrl: "",
    environmentId: "env-primary",
    status: "active",
    useWorktrees: true,
    workingDirectory: "",
    defaultPersonaId: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("linkEnvironment", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = getHandlers();
  });

  it("links an environment and returns workspace with linked IDs", async () => {
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue(makeWorkspaceRow() as never);
    vi.mocked(envRegistry.getEnvironment).mockReturnValue({ id: "env-2" } as never);
    vi.mocked(workspaceEnvironmentLinkStore.isLinked).mockReturnValue(false);
    vi.mocked(workspaceEnvironmentLinkStore.getLinkedEnvironmentIds).mockReturnValue(["env-2"]);

    const result = await handlers.linkEnvironment({
      workspaceId: "ws-1",
      environmentId: "env-2",
    });

    expect(workspaceEnvironmentLinkStore.linkEnvironment).toHaveBeenCalledWith("ws-1", "env-2");
    expect(result.linkedEnvironmentIds).toEqual(["env-2"]);
  });

  it("throws NotFound when workspace does not exist", async () => {
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue(undefined);

    const err = await handlers.linkEnvironment({
      workspaceId: "nope",
      environmentId: "env-2",
    }).catch((e: unknown) => e) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });

  it("throws NotFound when environment does not exist", async () => {
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue(makeWorkspaceRow() as never);
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(undefined);

    const err = await handlers.linkEnvironment({
      workspaceId: "ws-1",
      environmentId: "nope",
    }).catch((e: unknown) => e) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });

  it("throws InvalidArgument when linking primary environment", async () => {
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue(makeWorkspaceRow() as never);
    vi.mocked(envRegistry.getEnvironment).mockReturnValue({ id: "env-primary" } as never);

    const err = await handlers.linkEnvironment({
      workspaceId: "ws-1",
      environmentId: "env-primary",
    }).catch((e: unknown) => e) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("throws InvalidArgument when link already exists", async () => {
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue(makeWorkspaceRow() as never);
    vi.mocked(envRegistry.getEnvironment).mockReturnValue({ id: "env-2" } as never);
    vi.mocked(workspaceEnvironmentLinkStore.isLinked).mockReturnValue(true);

    const err = await handlers.linkEnvironment({
      workspaceId: "ws-1",
      environmentId: "env-2",
    }).catch((e: unknown) => e) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
  });
});

describe("unlinkEnvironment", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = getHandlers();
  });

  it("unlinks an environment and returns workspace without it", async () => {
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue(makeWorkspaceRow() as never);
    vi.mocked(workspaceEnvironmentLinkStore.isLinked).mockReturnValue(true);
    vi.mocked(workspaceEnvironmentLinkStore.getLinkedEnvironmentIds).mockReturnValue([]);

    const result = await handlers.unlinkEnvironment({
      workspaceId: "ws-1",
      environmentId: "env-2",
    });

    expect(workspaceEnvironmentLinkStore.unlinkEnvironment).toHaveBeenCalledWith("ws-1", "env-2");
    expect(result.linkedEnvironmentIds).toEqual([]);
  });

  it("throws NotFound when workspace does not exist", async () => {
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue(undefined);

    const err = await handlers.unlinkEnvironment({
      workspaceId: "nope",
      environmentId: "env-2",
    }).catch((e: unknown) => e) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });

  it("throws NotFound when link does not exist", async () => {
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue(makeWorkspaceRow() as never);
    vi.mocked(workspaceEnvironmentLinkStore.isLinked).mockReturnValue(false);

    const err = await handlers.unlinkEnvironment({
      workspaceId: "ws-1",
      environmentId: "env-2",
    }).catch((e: unknown) => e) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });
});
