/**
 * Integration tests for gRPC widget registry handlers
 * (registerWidget, updateWidget, getWidget, listWidgets).
 *
 * Uses a real in-memory SQLite database; only side-effect modules are mocked.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
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

/** Widget shape returned by handlers. */
interface WidgetInfo {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  rendererKind: string;
  body: string;
  version: number;
}

const ENV_ID = "test-env-widgets";
const WS1 = "test-ws-widgets-1";
const WS2 = "test-ws-widgets-2";

describe("gRPC widget handlers", () => {
  let handlers: ReturnType<typeof getHandlers>;

  beforeAll(async () => {
    initTestDatabase();
    handlers = getHandlers();
    const { envRegistry, workspaceStore } = await import("@grackle-ai/database");
    if (!envRegistry.getEnvironment(ENV_ID)) {
      envRegistry.addEnvironment(ENV_ID, "Test Env", "local", "{}");
    }
    workspaceStore.createWorkspace(WS1, "WS One", "", "", ENV_ID);
    workspaceStore.createWorkspace(WS2, "WS Two", "", "", ENV_ID);
  });

  it("registerWidget + getWidget round-trip", async () => {
    const created = (await handlers.registerWidget({
      workspaceId: WS1,
      name: "cost-summary",
      body: "<div>cost</div>",
      ownerTaskId: "t1",
      ownerSessionId: "s1",
    })) as WidgetInfo;
    expect(created.id).toBeTruthy();
    expect(created.rendererKind).toBe("mcp-app-html");
    expect(created.version).toBe(1);

    const fetched = (await handlers.getWidget({ id: created.id })) as WidgetInfo;
    expect(fetched.name).toBe("cost-summary");
    expect(fetched.body).toBe("<div>cost</div>");
  });

  it("getWidget resolves by name within a workspace", async () => {
    await handlers.registerWidget({ workspaceId: WS1, name: "burndown", body: "<a/>" });
    const byName = (await handlers.getWidget({ name: "burndown", workspaceId: WS1 })) as WidgetInfo;
    expect(byName.name).toBe("burndown");
    expect(byName.workspaceId).toBe(WS1);
  });

  it("listWidgets is scoped to the workspace", async () => {
    await handlers.registerWidget({ workspaceId: WS2, name: "ws2-only", body: "<x/>" });
    const ws2 = (await handlers.listWidgets({ workspaceId: WS2 })) as { widgets: WidgetInfo[] };
    expect(ws2.widgets.every((w) => w.workspaceId === WS2)).toBe(true);
    expect(ws2.widgets.some((w) => w.name === "ws2-only")).toBe(true);
    expect(ws2.widgets.some((w) => w.name === "cost-summary")).toBe(false);
  });

  it("updateWidget bumps version and updates only provided fields", async () => {
    const created = (await handlers.registerWidget({ workspaceId: WS1, name: "editme", description: "orig", body: "old" })) as WidgetInfo;
    const updated = (await handlers.updateWidget({ id: created.id, workspaceId: WS1, body: "new" })) as WidgetInfo;
    expect(updated.body).toBe("new");
    expect(updated.description).toBe("orig");
    expect(updated.version).toBe(2);
  });

  it("getWidget hides widgets from another workspace (isolation)", async () => {
    const created = (await handlers.registerWidget({ workspaceId: WS1, name: "secret", body: "<s/>" })) as WidgetInfo;
    const err = (await handlers.getWidget({ id: created.id, workspaceId: WS2 }).catch((e: unknown) => e)) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });

  it("updateWidget denies cross-workspace edits", async () => {
    const created = (await handlers.registerWidget({ workspaceId: WS1, name: "guarded", body: "<g/>" })) as WidgetInfo;
    const err = (await handlers.updateWidget({ id: created.id, workspaceId: WS2, body: "hijacked" }).catch((e: unknown) => e)) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });

  it("registerWidget requires name and body", async () => {
    const noName = (await handlers.registerWidget({ workspaceId: WS1, name: "", body: "<x/>" }).catch((e: unknown) => e)) as ConnectError;
    expect(noName.code).toBe(Code.InvalidArgument);
    const noBody = (await handlers.registerWidget({ workspaceId: WS1, name: "x", body: "" }).catch((e: unknown) => e)) as ConnectError;
    expect(noBody.code).toBe(Code.InvalidArgument);
  });
});
