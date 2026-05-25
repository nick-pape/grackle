/**
 * Integration tests for gRPC component registry handlers
 * (registerComponent, updateComponent, getComponent, listComponents).
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

/** Component shape returned by handlers. */
interface ComponentInfo {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  rendererKind: string;
  body: string;
  version: number;
  promoted: boolean;
}

const ENV_ID = "test-env-components";
const WS1 = "test-ws-components-1";
const WS2 = "test-ws-components-2";

describe("gRPC component handlers", () => {
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

  it("registerComponent + getComponent round-trip (defaults to grackle-react)", async () => {
    const created = (await handlers.registerComponent({
      workspaceId: WS1,
      name: "cost-summary",
      body: "render(<div>cost</div>)",
      ownerTaskId: "t1",
      ownerSessionId: "s1",
    })) as ComponentInfo;
    expect(created.id).toBeTruthy();
    expect(created.rendererKind).toBe("grackle-react");
    expect(created.version).toBe(1);

    const fetched = (await handlers.getComponent({ id: created.id })) as ComponentInfo;
    expect(fetched.name).toBe("cost-summary");
    expect(fetched.body).toBe("render(<div>cost</div>)");
  });

  it("registerComponent honors an explicit rendererKind (raw HTML)", async () => {
    const created = (await handlers.registerComponent({
      workspaceId: WS1,
      name: "raw-card",
      rendererKind: "mcp-app-html",
      body: "<div>raw</div>",
    })) as ComponentInfo;
    expect(created.rendererKind).toBe("mcp-app-html");
  });

  it("getComponent resolves by name within a workspace", async () => {
    await handlers.registerComponent({ workspaceId: WS1, name: "burndown", body: "render(<a/>)" });
    const byName = (await handlers.getComponent({ name: "burndown", workspaceId: WS1 })) as ComponentInfo;
    expect(byName.name).toBe("burndown");
    expect(byName.workspaceId).toBe(WS1);
  });

  it("listComponents is scoped to the workspace", async () => {
    await handlers.registerComponent({ workspaceId: WS2, name: "ws2-only", body: "render(<x/>)" });
    const ws2 = (await handlers.listComponents({ workspaceId: WS2 })) as { components: ComponentInfo[] };
    expect(ws2.components.every((c) => c.workspaceId === WS2)).toBe(true);
    expect(ws2.components.some((c) => c.name === "ws2-only")).toBe(true);
    expect(ws2.components.some((c) => c.name === "cost-summary")).toBe(false);
  });

  it("updateComponent bumps version and updates only provided fields", async () => {
    const created = (await handlers.registerComponent({ workspaceId: WS1, name: "editme", description: "orig", body: "old" })) as ComponentInfo;
    const updated = (await handlers.updateComponent({ id: created.id, workspaceId: WS1, body: "new" })) as ComponentInfo;
    expect(updated.body).toBe("new");
    expect(updated.description).toBe("orig");
    expect(updated.version).toBe(2);
  });

  it("getComponent hides components from another workspace (isolation)", async () => {
    const created = (await handlers.registerComponent({ workspaceId: WS1, name: "secret", body: "render(<s/>)" })) as ComponentInfo;
    const err = (await handlers.getComponent({ id: created.id, workspaceId: WS2 }).catch((e: unknown) => e)) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });

  it("updateComponent denies cross-workspace edits", async () => {
    const created = (await handlers.registerComponent({ workspaceId: WS1, name: "guarded", body: "render(<g/>)" })) as ComponentInfo;
    const err = (await handlers.updateComponent({ id: created.id, workspaceId: WS2, body: "hijacked" }).catch((e: unknown) => e)) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });

  it("registerComponent requires name and body", async () => {
    const noName = (await handlers.registerComponent({ workspaceId: WS1, name: "", body: "render(<x/>)" }).catch((e: unknown) => e)) as ConnectError;
    expect(noName.code).toBe(Code.InvalidArgument);
    const noBody = (await handlers.registerComponent({ workspaceId: WS1, name: "x", body: "" }).catch((e: unknown) => e)) as ConnectError;
    expect(noBody.code).toBe(Code.InvalidArgument);
  });

  it("searchComponents finds workspace components (builtin:false)", async () => {
    await handlers.registerComponent({ workspaceId: WS1, name: "revenue-chart", description: "a chart of revenue over time", body: "render(<i/>)" });
    const res = (await handlers.searchComponents({ query: "chart", workspaceId: WS1, limit: 10 })) as {
      results: { component?: ComponentInfo; builtin: boolean }[];
    };
    const hit = res.results.find((r) => r.component?.name === "revenue-chart");
    expect(hit).toBeDefined();
    expect(hit!.builtin).toBe(false);
  });

  it("searchComponents surfaces a Grackle built-in (builtin:true)", async () => {
    const res = (await handlers.searchComponents({ query: "button", workspaceId: WS1, limit: 10 })) as {
      results: { component?: ComponentInfo; builtin: boolean }[];
    };
    const btn = res.results.find((r) => r.component?.name === "Button");
    expect(btn).toBeDefined();
    expect(btn!.builtin).toBe(true);
    // Built-ins carry a self-describing sentinel id (not a real DB row).
    expect(btn!.component?.id).toBe("builtin:Button");
  });

  it("searchComponents is workspace-scoped for authored components", async () => {
    await handlers.registerComponent({ workspaceId: WS1, name: "ws1-private-thing", description: "scoped", body: "render(<i/>)" });
    const res = (await handlers.searchComponents({ query: "ws1-private-thing", workspaceId: WS2, limit: 10 })) as {
      results: { component?: ComponentInfo }[];
    };
    expect(res.results.some((r) => r.component?.name === "ws1-private-thing")).toBe(false);
  });

  it("searchComponents rejects an empty query", async () => {
    const err = (await handlers.searchComponents({ query: "  ", workspaceId: WS1 }).catch((e: unknown) => e)) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("searchComponents rejects an unknown workspaceId (fails fast, not silent built-ins)", async () => {
    const err = (await handlers.searchComponents({ query: "button", workspaceId: "no-such-workspace" }).catch((e: unknown) => e)) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });

  it("setComponentPromotion promotes by id and does not bump version", async () => {
    const created = (await handlers.registerComponent({ workspaceId: WS1, name: "promo-by-id", body: "render(<i/>)" })) as ComponentInfo;
    expect(created.promoted).toBe(false);
    const promoted = (await handlers.setComponentPromotion({ id: created.id, workspaceId: WS1, promoted: true })) as ComponentInfo;
    expect(promoted.promoted).toBe(true);
    expect(promoted.version).toBe(created.version);
    // Demote round-trip.
    const demoted = (await handlers.setComponentPromotion({ id: created.id, workspaceId: WS1, promoted: false })) as ComponentInfo;
    expect(demoted.promoted).toBe(false);
  });

  it("setComponentPromotion resolves by name within the workspace", async () => {
    await handlers.registerComponent({ workspaceId: WS1, name: "promo-by-name", body: "render(<i/>)" });
    const promoted = (await handlers.setComponentPromotion({ name: "promo-by-name", workspaceId: WS1, promoted: true })) as ComponentInfo;
    expect(promoted.name).toBe("promo-by-name");
    expect(promoted.promoted).toBe(true);
  });

  it("setComponentPromotion denies cross-workspace promotion (NotFound)", async () => {
    const created = (await handlers.registerComponent({ workspaceId: WS1, name: "promo-guarded", body: "render(<i/>)" })) as ComponentInfo;
    const err = (await handlers.setComponentPromotion({ id: created.id, workspaceId: WS2, promoted: true }).catch((e: unknown) => e)) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });

  it("setComponentPromotion is NotFound for an unknown id", async () => {
    const err = (await handlers.setComponentPromotion({ id: "no-such-id", workspaceId: WS1, promoted: true }).catch((e: unknown) => e)) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });

  it("setComponentPromotion requires id or name", async () => {
    const err = (await handlers.setComponentPromotion({ workspaceId: WS1, promoted: true }).catch((e: unknown) => e)) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
  });
});
