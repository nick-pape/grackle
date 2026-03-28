/**
 * Integration tests for gRPC finding handlers (postFinding, getFinding, queryFindings).
 *
 * Uses a real in-memory SQLite database; only side-effect modules are mocked.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";

// ── Mock side-effect modules ──
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
  buildOrchestratorContext: vi.fn(() => ""),
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

/** Finding shape returned by handlers. */
interface FindingInfo {
  id: string;
  workspaceId: string;
  taskId: string;
  sessionId: string;
  category: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
}

/** The test workspace ID seeded before tests. */
const TEST_WORKSPACE_ID = "test-ws-findings";
const TEST_ENV_ID = "test-env-findings";

describe("gRPC finding handlers", () => {
  let handlers: ReturnType<typeof getHandlers>;

  beforeAll(async () => {
    initTestDatabase();
    handlers = getHandlers();

    // Seed an environment and workspace for findings to reference.
    const { envRegistry, workspaceStore } = await import("@grackle-ai/database");
    if (!envRegistry.getEnvironment(TEST_ENV_ID)) {
      envRegistry.addEnvironment(TEST_ENV_ID, "Test Env", "local", "{}");
    }
    workspaceStore.createWorkspace(TEST_WORKSPACE_ID, "Test Workspace", "", "", TEST_ENV_ID);
  });

  it("postFinding + getFinding round-trip", async () => {
    const created = (await handlers.postFinding({
      workspaceId: TEST_WORKSPACE_ID,
      taskId: "",
      sessionId: "",
      category: "bug",
      title: "Found a bug",
      content: "Details about the bug",
      tags: ["frontend"],
    })) as FindingInfo;

    expect(created).toBeDefined();
    expect(created.title).toBe("Found a bug");
    expect(created.category).toBe("bug");
    expect(created.id).toBeTruthy();

    // Retrieve by ID
    const fetched = (await handlers.getFinding({ id: created.id })) as FindingInfo;
    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe("Found a bug");
    expect(fetched.content).toBe("Details about the bug");
    expect(fetched.tags).toEqual(["frontend"]);
  });

  it("getFinding with empty ID throws InvalidArgument", async () => {
    const err = (await handlers
      .getFinding({ id: "" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.message).toContain("required");
  });

  it("getFinding with unknown ID throws NotFound", async () => {
    const err = (await handlers
      .getFinding({ id: "nonexistent-finding-xyz" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });

  it("queryFindings with empty workspaceId returns cross-workspace results", async () => {
    // Seed a second workspace
    const { workspaceStore } = await import("@grackle-ai/database");
    const secondWorkspaceId = "test-ws-findings-2";
    try {
      workspaceStore.createWorkspace(secondWorkspaceId, "Second WS", "", "", TEST_ENV_ID);
    } catch {
      // Already exists from a previous run — ignore
    }

    // Post findings to both workspaces
    await handlers.postFinding({
      workspaceId: TEST_WORKSPACE_ID,
      taskId: "",
      sessionId: "",
      category: "general",
      title: "WS1 Finding",
      content: "Content",
      tags: [],
    });
    await handlers.postFinding({
      workspaceId: secondWorkspaceId,
      taskId: "",
      sessionId: "",
      category: "general",
      title: "WS2 Finding",
      content: "Content",
      tags: [],
    });

    // Query with empty workspaceId — should return findings from both workspaces
    const result = (await handlers.queryFindings({
      workspaceId: "",
      categories: [],
      tags: [],
      limit: 0,
    })) as { findings: FindingInfo[] };

    expect(result.findings).toBeDefined();
    expect(Array.isArray(result.findings)).toBe(true);
    const titles = result.findings.map((f) => f.title);
    expect(titles).toContain("WS1 Finding");
    expect(titles).toContain("WS2 Finding");
  });

  it("queryFindings with workspaceId returns only that workspace's findings", async () => {
    const result = (await handlers.queryFindings({
      workspaceId: TEST_WORKSPACE_ID,
      categories: [],
      tags: [],
      limit: 0,
    })) as { findings: FindingInfo[] };

    expect(result.findings).toBeDefined();
    for (const f of result.findings) {
      expect(f.workspaceId).toBe(TEST_WORKSPACE_ID);
    }
  });

  it("postFinding without title throws InvalidArgument", async () => {
    const err = (await handlers
      .postFinding({
        workspaceId: TEST_WORKSPACE_ID,
        taskId: "",
        sessionId: "",
        category: "general",
        title: "",
        content: "Content without title",
        tags: [],
      })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.message).toContain("title");
  });
});
