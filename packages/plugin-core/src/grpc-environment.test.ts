/**
 * Integration tests for gRPC environment handlers (addEnvironment, updateEnvironment, listEnvironments).
 *
 * Uses a real in-memory SQLite database; only side-effect modules are mocked.
 * Migrated from tests/e2e-tests/tests/add-environment.spec.ts (WS Handler + Update sections).
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

/** Environment shape returned by listEnvironments. */
interface EnvironmentInfo {
  id: string;
  displayName: string;
  adapterType: string;
  adapterConfig: string;
}

// Initialize database once for all describes in this file.
// openDatabase(":memory:") is a no-op after first call, so a single
// beforeAll at the top level ensures both describes share one DB.
let handlers: ReturnType<typeof getHandlers>;

beforeAll(() => {
  initTestDatabase();
  handlers = getHandlers();
});

describe("gRPC addEnvironment handlers", () => {

  /** Helper to list all environments. */
  async function listEnvironments(): Promise<EnvironmentInfo[]> {
    const result = (await handlers.listEnvironments()) as {
      environments: EnvironmentInfo[];
    };
    return result.environments;
  }

  it("addEnvironment creates environment visible in list", async () => {
    const response = (await handlers.addEnvironment({
      displayName: "integration-test-env",
      adapterType: "local",
      adapterConfig: "{}",
    })) as EnvironmentInfo;

    expect(response.id).toBeTruthy();

    const envs = await listEnvironments();
    const added = envs.find((e) => e.displayName === "integration-test-env");
    expect(added).toBeDefined();
  });

  it("addEnvironment returns error when displayName is missing", async () => {
    const err = (await handlers
      .addEnvironment({ displayName: "", adapterType: "local" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.message).toContain("displayName and adapterType required");
  });

  it("addEnvironment returns error when adapterType is missing", async () => {
    const err = (await handlers
      .addEnvironment({ displayName: "missing-adapter", adapterType: "" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.message).toContain("displayName and adapterType required");
  });

  it("addEnvironment accepts pre-serialized adapterConfig string without double-encoding", async () => {
    const response = (await handlers.addEnvironment({
      displayName: "string-config-env",
      adapterType: "local",
      adapterConfig: '{"host":"localhost","port":1234}',
    })) as EnvironmentInfo;

    expect(response.id).toBeTruthy();

    const envs = await listEnvironments();
    const added = envs.find((e) => e.displayName === "string-config-env");
    expect(added).toBeTruthy();
    expect(added!.adapterConfig).toBe('{"host":"localhost","port":1234}');
  });
});

describe("gRPC updateEnvironment handlers", () => {

  /** Helper to create an environment and return its ID. */
  async function createEnv(displayName: string): Promise<string> {
    const response = (await handlers.addEnvironment({
      displayName,
      adapterType: "local",
      adapterConfig: "{}",
    })) as EnvironmentInfo;
    return response.id;
  }

  /** Helper to list all environments. */
  async function listEnvironments(): Promise<EnvironmentInfo[]> {
    const result = (await handlers.listEnvironments()) as {
      environments: EnvironmentInfo[];
    };
    return result.environments;
  }

  it("updateEnvironment changes displayName", async () => {
    const environmentId = await createEnv("update-name-test");

    await handlers.updateEnvironment({
      id: environmentId,
      displayName: "updated-name",
    });

    const envs = await listEnvironments();
    const updated = envs.find((e) => e.id === environmentId);
    expect(updated?.displayName).toBe("updated-name");
  });

  it("updateEnvironment changes adapterConfig", async () => {
    const environmentId = await createEnv("update-config-test");

    await handlers.updateEnvironment({
      id: environmentId,
      adapterConfig: '{"host":"1.2.3.4","port":9999}',
    });

    const envs = await listEnvironments();
    const updated = envs.find((e) => e.id === environmentId);
    expect(JSON.parse(updated!.adapterConfig)).toEqual({ host: "1.2.3.4", port: 9999 });
  });

  it("updateEnvironment rejects empty name", async () => {
    const environmentId = await createEnv("empty-name-test");

    const err = (await handlers
      .updateEnvironment({ id: environmentId, displayName: "  " })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.message).toContain("Environment name cannot be empty");
  });

  it("updateEnvironment rejects unknown environment ID", async () => {
    const err = (await handlers
      .updateEnvironment({ id: "nonexistent-env-id", displayName: "should-fail" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
    expect(err.message).toContain("Environment not found");
  });
});
