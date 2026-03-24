/**
 * Integration tests for gRPC token handlers (setToken, listTokens, deleteToken).
 *
 * Uses a real in-memory SQLite database; only side-effect modules are mocked.
 * Migrated from tests/e2e-tests/tests/token-management.spec.ts.
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

// ── Mock external packages (inline factories — can't use __mocks__ in Rush monorepo) ──
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

describe("gRPC token handlers", () => {
  let handlers: ReturnType<typeof getHandlers>;

  beforeAll(() => {
    initTestDatabase();
    handlers = getHandlers();
  });

  it("listTokens returns an empty array initially", async () => {
    const result = (await handlers.listTokens()) as { tokens: unknown[] };
    expect(result.tokens).toBeDefined();
    expect(Array.isArray(result.tokens)).toBe(true);
  });

  it("setToken + listTokens round-trip", async () => {
    await handlers.setToken({
      name: "test-token-rt",
      value: "secret-value-123",
      type: "env_var",
      envVar: "TEST_TOKEN_RT",
      filePath: "",
    });

    const result = (await handlers.listTokens()) as {
      tokens: Array<{ name: string; type: string; envVar: string }>;
    };
    const found = result.tokens.find((t) => t.name === "test-token-rt");
    expect(found).toBeDefined();
    expect(found!.type).toBe("env_var");
    expect(found!.envVar).toBe("TEST_TOKEN_RT");

    // Clean up
    await handlers.deleteToken({ name: "test-token-rt" });
  });

  it("setToken with file type stores filePath", async () => {
    await handlers.setToken({
      name: "test-file-token",
      value: "file-secret",
      type: "file",
      envVar: "",
      filePath: "/home/user/.secret",
    });

    const result = (await handlers.listTokens()) as {
      tokens: Array<{ name: string; type: string; filePath: string }>;
    };
    const found = result.tokens.find((t) => t.name === "test-file-token");
    expect(found).toBeDefined();
    expect(found!.type).toBe("file");
    expect(found!.filePath).toBe("/home/user/.secret");

    await handlers.deleteToken({ name: "test-file-token" });
  });

  it("deleteToken removes token from list", async () => {
    await handlers.setToken({
      name: "test-delete-me",
      value: "to-be-deleted",
      type: "env_var",
      envVar: "DELETE_ME",
      filePath: "",
    });

    // Verify it exists
    let result = (await handlers.listTokens()) as {
      tokens: Array<{ name: string }>;
    };
    expect(result.tokens.find((t) => t.name === "test-delete-me")).toBeDefined();

    // Delete it
    await handlers.deleteToken({ name: "test-delete-me" });

    // Verify it's gone
    result = (await handlers.listTokens()) as { tokens: Array<{ name: string }> };
    expect(result.tokens.find((t) => t.name === "test-delete-me")).toBeUndefined();
  });

  it("setToken without name returns error", async () => {
    const err = (await handlers
      .setToken({ name: "", value: "something", type: "env_var" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.message).toContain("required");
  });

  it("setToken without value returns error", async () => {
    const err = (await handlers
      .setToken({ name: "no-value-token", value: "", type: "env_var" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.message).toContain("required");
  });

  it("deleteToken without name returns error", async () => {
    const err = (await handlers
      .deleteToken({ name: "" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.message).toContain("required");
  });

  it("setToken overwrites existing token", async () => {
    await handlers.setToken({
      name: "test-overwrite",
      value: "original-value",
      type: "env_var",
      envVar: "ORIGINAL_VAR",
      filePath: "",
    });

    await handlers.setToken({
      name: "test-overwrite",
      value: "updated-value",
      type: "env_var",
      envVar: "UPDATED_VAR",
      filePath: "",
    });

    const result = (await handlers.listTokens()) as {
      tokens: Array<{ name: string; envVar: string }>;
    };
    const found = result.tokens.find((t) => t.name === "test-overwrite");
    expect(found?.envVar).toBe("UPDATED_VAR");

    const count = result.tokens.filter((t) => t.name === "test-overwrite").length;
    expect(count).toBe(1);

    await handlers.deleteToken({ name: "test-overwrite" });
  });

  it("token values are not exposed in listTokens response", async () => {
    await handlers.setToken({
      name: "test-no-value",
      value: "super-secret",
      type: "env_var",
      envVar: "SECRET_VAR",
      filePath: "",
    });

    const result = (await handlers.listTokens()) as {
      tokens: Array<Record<string, unknown>>;
    };
    const found = result.tokens.find((t) => t.name === "test-no-value");
    expect(found).toBeDefined();
    // Value must not be present in the response
    expect("value" in (found as Record<string, unknown>)).toBe(false);

    await handlers.deleteToken({ name: "test-no-value" });
  });

  it("deleteToken for non-existent name succeeds silently", async () => {
    // Should not throw
    await handlers.deleteToken({ name: "nonexistent-token-xyz" });
  });
});
