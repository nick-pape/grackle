/**
 * Integration tests for gRPC persona handlers.
 *
 * Uses a real in-memory SQLite database; only side-effect modules are mocked.
 * Migrated from tests/e2e-tests/tests/persona.spec.ts (9 of 13 tests).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { ConnectError } from "@connectrpc/connect";

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

/** Persona shape returned by listPersonas. */
interface PersonaInfo {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  runtime: string;
  model: string;
  maxTurns: number;
  allowedMcpTools: string[];
}

describe("gRPC persona handlers", () => {
  let handlers: ReturnType<typeof getHandlers>;

  beforeAll(() => {
    initTestDatabase();
    handlers = getHandlers();
  });

  /** Helper to list all personas. */
  async function listPersonas(): Promise<PersonaInfo[]> {
    const result = (await handlers.listPersonas()) as { personas: PersonaInfo[] };
    return result.personas;
  }

  it("createPersona + listPersonas round-trip", async () => {
    await handlers.createPersona({
      name: "Test Engineer",
      description: "Writes tests",
      systemPrompt: "You are a test engineer. Write thorough unit tests.",
      runtime: "stub",
      model: "sonnet",
      maxTurns: 5,
      mcpServers: [],
    });

    const personas = await listPersonas();
    const created = personas.find((p) => p.name === "Test Engineer");
    expect(created).toBeDefined();
    expect(created!.runtime).toBe("stub");
  });

  it("deletePersona removes persona from list", async () => {
    await handlers.createPersona({
      name: "Temp Persona",
      systemPrompt: "Temporary",
      mcpServers: [],
    });

    const before = await listPersonas();
    const temp = before.find((p) => p.name === "Temp Persona");
    expect(temp).toBeDefined();

    await handlers.deletePersona({ id: temp!.id });

    const after = await listPersonas();
    expect(after.find((p) => p.name === "Temp Persona")).toBeUndefined();
  });

  it("updatePersona changes persona fields", async () => {
    const created = (await handlers.createPersona({
      name: "Original Name",
      systemPrompt: "Original prompt",
      runtime: "stub",
      mcpServers: [],
    })) as PersonaInfo;

    await handlers.updatePersona({
      id: created.id,
      name: "Updated Name",
      systemPrompt: "Updated prompt",
    });

    const personas = await listPersonas();
    expect(personas.find((p) => p.name === "Updated Name")).toBeDefined();
    expect(personas.find((p) => p.name === "Original Name")).toBeUndefined();
  });

  it("createPersona with all fields and verify full round-trip", async () => {
    await handlers.createPersona({
      name: "Full Fields Persona",
      description: "Has every field set",
      systemPrompt: "You are a comprehensive persona.",
      runtime: "stub",
      model: "opus",
      maxTurns: 25,
      mcpServers: [],
    });

    const personas = await listPersonas();
    const p = personas.find((x) => x.name === "Full Fields Persona");
    expect(p).toBeDefined();
    expect(p!.description).toBe("Has every field set");
    expect(p!.systemPrompt).toBe("You are a comprehensive persona.");
    expect(p!.runtime).toBe("stub");
    expect(p!.model).toBe("opus");
    expect(p!.maxTurns).toBe(25);
  });

  it("createPersona with minimal fields defaults correctly", async () => {
    await handlers.createPersona({
      name: "Minimal Persona",
      systemPrompt: "Just a prompt.",
      mcpServers: [],
    });

    const personas = await listPersonas();
    const p = personas.find((x) => x.name === "Minimal Persona");
    expect(p).toBeDefined();
    expect(p!.description).toBe("");
    expect(p!.model).toBe("");
    expect(p!.maxTurns).toBe(0);
  });

  it("createPersona without name returns error", async () => {
    const err = (await handlers
      .createPersona({ name: "", systemPrompt: "missing name" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.message).toBeTruthy();
  });

  it("createPersona without systemPrompt returns error", async () => {
    const err = (await handlers
      .createPersona({ name: "No Prompt", systemPrompt: "" })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.message).toBeTruthy();
  });

  it("deletePersona for non-existent ID does not crash", async () => {
    // Should not throw — DELETE WHERE id = 'nope' is a no-op
    await handlers.deletePersona({ id: "nonexistent-id" });

    // Verify the connection is still healthy
    const personas = await listPersonas();
    expect(Array.isArray(personas)).toBe(true);
  });

  it("createPersona with allowedMcpTools round-trips correctly", async () => {
    const created = (await handlers.createPersona({
      name: "Scoped Agent",
      systemPrompt: "You have scoped tools.",
      runtime: "stub",
      mcpServers: [],
      allowedMcpTools: ["finding_post", "task_list"],
    })) as PersonaInfo;

    const personas = await listPersonas();
    const p = personas.find((x) => x.name === "Scoped Agent");
    expect(p).toBeDefined();
    expect(p!.allowedMcpTools).toEqual(["finding_post", "task_list"]);
  });

  it("createPersona rejects unknown tool names in allowedMcpTools", async () => {
    const err = (await handlers
      .createPersona({
        name: "Bad Tools",
        systemPrompt: "prompt",
        mcpServers: [],
        allowedMcpTools: ["finding_post", "nonexistent_tool"],
      })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.message).toContain("nonexistent_tool");
  });

  it("updatePersona preserves allowedMcpTools when empty array is sent", async () => {
    const created = (await handlers.createPersona({
      name: "Preserve MCP Tools",
      systemPrompt: "prompt",
      runtime: "stub",
      mcpServers: [],
      allowedMcpTools: ["finding_post", "task_create"],
    })) as PersonaInfo;

    // Empty array = "not provided" in proto3; server preserves existing value
    await handlers.updatePersona({
      id: created.id,
      name: "Preserve MCP Tools Renamed",
      allowedMcpTools: [],
    });

    const personas = await listPersonas();
    const p = personas.find((x) => x.name === "Preserve MCP Tools Renamed");
    expect(p).toBeDefined();
    expect(p!.allowedMcpTools).toEqual(["finding_post", "task_create"]);
  });

  it("updatePersona clears allowedMcpTools with __clear__ sentinel", async () => {
    const created = (await handlers.createPersona({
      name: "Clear MCP Tools",
      systemPrompt: "prompt",
      runtime: "stub",
      mcpServers: [],
      allowedMcpTools: ["finding_post", "task_create"],
    })) as PersonaInfo;

    // "__clear__" sentinel resets to default (empty array)
    await handlers.updatePersona({
      id: created.id,
      allowedMcpTools: ["__clear__"],
    });

    const personas = await listPersonas();
    const p = personas.find((x) => x.name === "Clear MCP Tools");
    expect(p).toBeDefined();
    expect(p!.allowedMcpTools).toEqual([]);
  });

  it("updatePersona replaces allowedMcpTools when provided", async () => {
    const created = (await handlers.createPersona({
      name: "Replace MCP Tools",
      systemPrompt: "prompt",
      runtime: "stub",
      mcpServers: [],
      allowedMcpTools: ["finding_post"],
    })) as PersonaInfo;

    await handlers.updatePersona({
      id: created.id,
      allowedMcpTools: ["task_list", "task_create"],
    });

    const personas = await listPersonas();
    const p = personas.find((x) => x.name === "Replace MCP Tools");
    expect(p).toBeDefined();
    expect(p!.allowedMcpTools).toEqual(["task_list", "task_create"]);
  });

  it("updatePersona preserves fields that are not provided", async () => {
    const created = (await handlers.createPersona({
      name: "Preserve Test",
      description: "Original desc",
      systemPrompt: "Original system prompt",
      runtime: "stub",
      model: "sonnet",
      maxTurns: 10,
      mcpServers: [],
    })) as PersonaInfo;

    // Update only the name
    await handlers.updatePersona({
      id: created.id,
      name: "Preserve Test Renamed",
    });

    const personas = await listPersonas();
    const renamed = personas.find((x) => x.name === "Preserve Test Renamed");
    expect(renamed).toBeDefined();
    expect(renamed!.description).toBe("Original desc");
    expect(renamed!.systemPrompt).toBe("Original system prompt");
    expect(renamed!.runtime).toBe("stub");
    expect(renamed!.model).toBe("sonnet");
    expect(renamed!.maxTurns).toBe(10);
  });
});
