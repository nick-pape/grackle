/**
 * Integration tests for gRPC handler error states and validation.
 *
 * Uses a real in-memory SQLite database; only side-effect modules are mocked.
 * Migrated from tests/e2e-tests/tests/error-states.spec.ts (8 of 9 tests).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";

// ── Mock side-effect modules (resolved via __mocks__/ directory) ──
vi.mock("./logger.js");
vi.mock("./log-writer.js");
vi.mock("./stream-hub.js");
vi.mock("./event-bus.js");
vi.mock("./token-push.js");
vi.mock("./adapter-manager.js");
vi.mock("./event-processor.js");
vi.mock("./processor-registry.js");
vi.mock("./session-recovery.js");
vi.mock("./auto-reconnect.js");
vi.mock("./lifecycle.js");
vi.mock("./knowledge-init.js");
vi.mock("./reanimate-agent.js");
vi.mock("./github-import.js");
vi.mock("./stream-registry.js");
vi.mock("./pipe-delivery.js");
vi.mock("./utils/exec.js");
vi.mock("./utils/network.js");
vi.mock("./utils/format-gh-error.js");

// ── Mock external packages ──
vi.mock("@grackle-ai/adapter-sdk", () => ({
  reconnectOrProvision: vi.fn(async function* () { /* empty */ }),
}));
vi.mock("@grackle-ai/prompt", () => ({
  resolvePersona: vi.fn(),
  fetchOrchestratorContext: vi.fn(() => ""),
  SystemPromptBuilder: vi.fn().mockImplementation(() => ({ build: () => "" })),
  buildTaskPrompt: vi.fn((t: string) => t),
}));
vi.mock("@grackle-ai/auth", () => ({
  createScopedToken: vi.fn(() => "mock-token"),
  loadOrCreateApiKey: vi.fn(() => "mock-api-key"),
  generatePairingCode: vi.fn(() => ({ code: "mock-code", token: "mock-token" })),
}));
vi.mock("@grackle-ai/knowledge", () => ({
  knowledgeSearch: vi.fn(),
  getNode: vi.fn(),
  expandNode: vi.fn(),
  createNativeNode: vi.fn(),
  ingest: vi.fn(),
  createPassThroughChunker: vi.fn(),
  listRecentNodes: vi.fn(),
}));

// ── Import AFTER mocks ──
import { initTestDatabase, getHandlers } from "./test-utils/integration-setup.js";

describe("gRPC error states", () => {
  let handlers: ReturnType<typeof getHandlers>;

  beforeAll(() => {
    initTestDatabase();
    handlers = getHandlers();
  });

  // ─── createTask errors ──────────────────────────────────

  it("createTask with missing workspaceId succeeds (root task)", async () => {
    const result = (await handlers.createTask({
      title: "orphan-task",
      dependsOn: [],
    })) as { id: string };

    expect(result.id).toBeTruthy();
  });

  it("createTask with missing title returns error", async () => {
    const err = (await handlers
      .createTask({ title: "" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.message).toContain("required");
  });

  it("createTask with non-existent workspace returns error", async () => {
    const err = (await handlers
      .createTask({ workspaceId: "does-not-exist-999", title: "ghost-task" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
    expect(err.message).toContain("not found");
  });

  // ─── startTask errors ───────────────────────────────────

  it("startTask on non-existent task returns error", async () => {
    const err = (await handlers
      .startTask({ taskId: "nonexistent-task-id" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
    expect(err.message).toContain("not found");
  });

  it("startTask on task with unmet dependencies returns error", async () => {
    // Create an environment for the workspace (required by foreign key)
    const env = (await handlers.addEnvironment({
      displayName: "err-deps-env",
      adapterType: "local",
      adapterConfig: "{}",
    })) as { id: string };

    // Create workspace
    const workspace = (await handlers.createWorkspace({
      name: "err-deps",
      environmentId: env.id,
    })) as { id: string };

    // Create a blocker task
    const blocker = (await handlers.createTask({
      workspaceId: workspace.id,
      title: "err-blocker",
      dependsOn: [],
    })) as { id: string };

    // Create a dependent task that depends on the blocker
    const dependent = (await handlers.createTask({
      workspaceId: workspace.id,
      title: "err-blocked",
      dependsOn: [blocker.id],
    })) as { id: string };

    // Try to start the blocked task — blocker is not_started so deps aren't met
    const err = (await handlers
      .startTask({ taskId: dependent.id })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("unmet dependencies");
  });

  // ─── postFinding errors ─────────────────────────────────

  it("postFinding with missing title returns error", async () => {
    // Create environment and workspace for the finding
    const env = (await handlers.addEnvironment({
      displayName: "err-finding-env",
      adapterType: "local",
      adapterConfig: "{}",
    })) as { id: string };

    const workspace = (await handlers.createWorkspace({
      name: "err-finding",
      environmentId: env.id,
    })) as { id: string };

    const err = (await handlers
      .postFinding({ workspaceId: workspace.id, title: "" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.message).toContain("required");
  });

  // ─── spawnAgent errors ──────────────────────────────────

  it("spawnAgent with missing environmentId returns error", async () => {
    const err = (await handlers
      .spawnAgent({ environmentId: "", prompt: "hello" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.message).toContain("required");
  });

  // ─── createWorkspace errors ─────────────────────────────

  it("createWorkspace with empty name returns error", async () => {
    const err = (await handlers
      .createWorkspace({ name: "" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.message).toContain("required");
  });
});
