/**
 * Full in-process integration test for the GetSessionActions read path
 * (RFC #1264 / AHP HR1a). Stands up the real assembled route table over an
 * in-process ConnectRPC transport and calls the RPC over the wire against a
 * real in-memory SQLite DB — exercising route registration + proto
 * (de)serialization + handler + the durable store together.
 *
 * Uses a real database; only side-effect modules are mocked (mirrors
 * grpc-token.test.ts, required because importing grpc-service.js pulls in all
 * built-in handler groups via createDefaultCollector()).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { createRouterTransport, createClient, type Client } from "@connectrpc/connect";

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

// ── Mock external packages (inline factories — can't use __mocks__ in Rush monorepo) ──
vi.mock("@grackle-ai/adapter-sdk", () => ({
  reconnectOrProvision: vi.fn(async function* () {
    /* empty */
  }),
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

// ── Import AFTER mocks (real database, not mocked) ──
import { grackle } from "@grackle-ai/common";
import { persistSessionAction } from "@grackle-ai/database";
import { initTestDatabase } from "./test-utils/integration-setup.js";
import { createDefaultCollector } from "./grpc-service.js";

/** Seed one session action with an explicit seq. */
function seed(seq: string, sessionId: string, content: string): void {
  persistSessionAction({
    seq,
    sessionId,
    type: "text",
    content,
    raw: "",
    timestamp: "2026-05-24T00:00:00.000Z",
  });
}

describe("GetSessionActions (in-process integration)", () => {
  let client: Client<typeof grackle.GrackleCore>;

  beforeAll(() => {
    initTestDatabase();

    // Seed actions for two sessions through the real store.
    seed("01A", "sess-order", "a");
    seed("01B", "sess-order", "b");
    seed("01C", "sess-order", "c");
    for (let i = 0; i < 5; i++) {
      seed(`01L${i}`, "sess-limit", `m${i}`);
    }

    // Stand up the real route table over an in-process transport.
    const transport = createRouterTransport(createDefaultCollector().buildRoutes());
    client = createClient(grackle.GrackleCore, transport);
  });

  it("returns a session's actions oldest-first over the wire", async () => {
    const res = await client.getSessionActions({ sessionId: "sess-order" });
    expect(res.actions.map((a) => a.seq)).toEqual(["01A", "01B", "01C"]);
    expect(res.actions.map((a) => a.content)).toEqual(["a", "b", "c"]);
    // Proto round-trips the row fields.
    expect(res.actions[0]).toMatchObject({ sessionId: "sess-order", type: "text", content: "a" });
  });

  it("fromSeq pages to the actions after the cursor (exclusive)", async () => {
    const res = await client.getSessionActions({ sessionId: "sess-order", fromSeq: "01A" });
    expect(res.actions.map((a) => a.seq)).toEqual(["01B", "01C"]);
  });

  it("limit caps the number of actions returned", async () => {
    const res = await client.getSessionActions({ sessionId: "sess-limit", limit: 2 });
    expect(res.actions).toHaveLength(2);
    expect(res.actions.map((a) => a.seq)).toEqual(["01L0", "01L1"]);
  });

  it("returns an empty list for an unknown session", async () => {
    const res = await client.getSessionActions({ sessionId: "does-not-exist" });
    expect(res.actions).toEqual([]);
  });
});
