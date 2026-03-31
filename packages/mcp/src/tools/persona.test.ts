import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { personaTools } from "./persona.js";

type GrackleClient = Client<typeof grackle.GrackleOrchestration>;

/** Look up a tool definition by name from the personaTools array. */
const getTool = (name: string) => personaTools.find((t) => t.name === name)!;

/** Reusable mock persona data for tests. */
const MOCK_PERSONA = {
  id: "per-1",
  name: "Code Reviewer",
  description: "Reviews pull requests",
  systemPrompt: "You are a code reviewer.",
  runtime: "claude-code",
  model: "claude-sonnet-4-20250514",
  maxTurns: 10,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  type: "agent",
  script: "",
};

describe("persona_list", () => {
  const tool = getTool("persona_list");

  /** Verify listPersonas returns all serialized persona fields. */
  test("happy path — returns personas", async () => {
    const mockClient = {
      listPersonas: vi.fn().mockResolvedValue({
        personas: [MOCK_PERSONA],
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler({}, { orchestration: mockClient });

    expect(mockClient.listPersonas).toHaveBeenCalledWith({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(MOCK_PERSONA);
    expect(result.isError).toBeUndefined();
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      listPersonas: vi.fn().mockRejectedValue(
        new ConnectError("unavailable", Code.Unavailable),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler({}, { orchestration: mockClient });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("unavailable");
    expect(parsed.code).toBe("UNAVAILABLE");
  });
});

describe("persona_create", () => {
  const tool = getTool("persona_create");

  /** Verify createPersona is called with correct args including mcpServers: []. */
  test("happy path with full args", async () => {
    const mockClient = {
      createPersona: vi.fn().mockResolvedValue(MOCK_PERSONA),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      {
        name: "Code Reviewer",
        systemPrompt: "You are a code reviewer.",
        description: "Reviews pull requests",
        runtime: "claude-code",
        model: "claude-sonnet-4-20250514",
        maxTurns: 10,
      },
      { orchestration: mockClient },
    );

    expect(mockClient.createPersona).toHaveBeenCalledWith({
      name: "Code Reviewer",
      systemPrompt: "You are a code reviewer.",
      description: "Reviews pull requests",
      runtime: "claude-code",
      model: "claude-sonnet-4-20250514",
      maxTurns: 10,
      mcpServers: [],
      type: "agent",
      script: "",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("per-1");
    expect(parsed.name).toBe("Code Reviewer");
    expect(result.isError).toBeUndefined();
  });

  /** Verify optional fields default to empty string/zero when omitted. */
  test("happy path with minimal args — defaults applied", async () => {
    const mockClient = {
      createPersona: vi.fn().mockResolvedValue({
        ...MOCK_PERSONA,
        id: "per-2",
        description: "",
        runtime: "",
        model: "",
        maxTurns: 0,
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { name: "Minimal", systemPrompt: "Do stuff." },
      { orchestration: mockClient },
    );

    expect(mockClient.createPersona).toHaveBeenCalledWith({
      name: "Minimal",
      systemPrompt: "Do stuff.",
      description: "",
      runtime: "",
      model: "",
      maxTurns: 0,
      mcpServers: [],
      type: "agent",
      script: "",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.description).toBe("");
    expect(parsed.runtime).toBe("");
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      createPersona: vi.fn().mockRejectedValue(
        new ConnectError("already exists", Code.AlreadyExists),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { name: "Dupe", systemPrompt: "prompt" },
      { orchestration: mockClient },
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("already exists");
    expect(parsed.code).toBe("ALREADY_EXISTS");
  });
});

describe("persona_show", () => {
  const tool = getTool("persona_show");

  /** Verify getPersona is called with the correct ID and response is serialized. */
  test("happy path", async () => {
    const mockClient = {
      getPersona: vi.fn().mockResolvedValue(MOCK_PERSONA),
    } as unknown as GrackleClient;

    const result = await tool.handler({ personaId: "per-1" }, { orchestration: mockClient });

    expect(mockClient.getPersona).toHaveBeenCalledWith({ id: "per-1" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(MOCK_PERSONA);
    expect(result.isError).toBeUndefined();
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      getPersona: vi.fn().mockRejectedValue(
        new ConnectError("persona not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler({ personaId: "per-missing" }, { orchestration: mockClient });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("persona not found");
    expect(parsed.code).toBe("NOT_FOUND");
  });
});

describe("persona_edit", () => {
  const tool = getTool("persona_edit");

  /** Verify updatePersona is called with correct args and mcpServers: []. */
  test("happy path with partial update", async () => {
    const updated = { ...MOCK_PERSONA, name: "Senior Reviewer" };
    const mockClient = {
      updatePersona: vi.fn().mockResolvedValue(updated),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { personaId: "per-1", name: "Senior Reviewer" },
      { orchestration: mockClient },
    );

    expect(mockClient.updatePersona).toHaveBeenCalledWith({
      id: "per-1",
      name: "Senior Reviewer",
      systemPrompt: "",
      description: "",
      runtime: "",
      model: "",
      maxTurns: 0,
      mcpServers: [],
      type: "",
      script: "",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("Senior Reviewer");
    expect(result.isError).toBeUndefined();
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      updatePersona: vi.fn().mockRejectedValue(
        new ConnectError("persona not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler(
      { personaId: "per-missing", name: "Nope" },
      { orchestration: mockClient },
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });
});

describe("persona_delete", () => {
  const tool = getTool("persona_delete");

  /** Verify deletePersona is called and returns success: true. */
  test("happy path", async () => {
    const mockClient = {
      deletePersona: vi.fn().mockResolvedValue({}),
    } as unknown as GrackleClient;

    const result = await tool.handler({ personaId: "per-1" }, { orchestration: mockClient });

    expect(mockClient.deletePersona).toHaveBeenCalledWith({ id: "per-1" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ success: true });
    expect(result.isError).toBeUndefined();
  });

  /** Verify gRPC ConnectError is surfaced as an error result. */
  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      deletePersona: vi.fn().mockRejectedValue(
        new ConnectError("persona not found", Code.NotFound),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler({ personaId: "per-missing" }, { orchestration: mockClient });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });
});
