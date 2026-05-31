import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the database layer used by the agent handlers.
const mockDb: {
  agents: Map<string, Record<string, unknown>>;
} = {
  agents: new Map(),
};

vi.mock("@grackle-ai/database", () => ({
  agentStore: {
    listAgents: (): Array<Record<string, unknown>> =>
      [...mockDb.agents.values()].sort((a, b) =>
        (a as { name: string }).name.localeCompare((b as { name: string }).name),
      ),
    getAgent: (id: string): Record<string, unknown> | undefined => mockDb.agents.get(id),
    getAgentByName: (name: string): Record<string, unknown> | undefined =>
      [...mockDb.agents.values()].find((a) => (a as { name: string }).name === name),
    createAgent: (id: string, name: string, avatar: string, primaryPersonaId: string): void => {
      mockDb.agents.set(id, {
        id,
        name,
        avatar,
        primaryPersonaId,
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      });
    },
    updateAgent: (
      id: string,
      fields: { name?: string; avatar?: string; primaryPersonaId?: string },
    ): void => {
      const existing = mockDb.agents.get(id);
      if (existing) {
        mockDb.agents.set(id, {
          ...existing,
          name: fields.name ?? (existing as { name: string }).name,
          avatar: fields.avatar ?? (existing as { avatar: string }).avatar,
          primaryPersonaId:
            fields.primaryPersonaId ?? (existing as { primaryPersonaId: string }).primaryPersonaId,
        });
      }
    },
    deleteAgent: (id: string): void => {
      mockDb.agents.delete(id);
    },
  },
  slugify: (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
}));

const emitMock = vi.fn();
vi.mock("@grackle-ai/core", () => ({
  emit: (type: string, payload: unknown) => emitMock(type, payload),
}));

import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import * as agentHandlers from "./agent-handlers.js";

describe("agent-handlers", () => {
  beforeEach(() => {
    mockDb.agents.clear();
    emitMock.mockClear();
  });

  it("createAgent + listAgents round-trip and emits agent.created", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, {
        name: "Refactor Bot",
        avatar: "🐦",
        primaryPersonaId: "p1",
      }),
    );
    expect(created.name).toBe("Refactor Bot");
    expect(created.avatar).toBe("🐦");
    expect(created.primaryPersonaId).toBe("p1");
    expect(emitMock).toHaveBeenCalledWith("agent.created", expect.objectContaining({}));

    const list = await agentHandlers.listAgents();
    expect(list.agents).toHaveLength(1);
    expect(list.agents[0].name).toBe("Refactor Bot");
  });

  it("lists agents ordered by name", async () => {
    await agentHandlers.createAgent(create(grackle.CreateAgentRequestSchema, { name: "Zeta" }));
    await agentHandlers.createAgent(create(grackle.CreateAgentRequestSchema, { name: "Alpha" }));
    const list = await agentHandlers.listAgents();
    expect(list.agents.map((a) => a.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("getAgent returns a created agent", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { name: "Findable" }),
    );
    const got = await agentHandlers.getAgent(create(grackle.AgentIdSchema, { id: created.id }));
    expect(got.name).toBe("Findable");
  });

  it("getAgent throws NotFound for a missing agent", async () => {
    await expect(
      agentHandlers.getAgent(create(grackle.AgentIdSchema, { id: "nope" })),
    ).rejects.toThrow(/not found/i);
  });

  it("createAgent rejects a duplicate name", async () => {
    await agentHandlers.createAgent(create(grackle.CreateAgentRequestSchema, { name: "Dupe" }));
    await expect(
      agentHandlers.createAgent(create(grackle.CreateAgentRequestSchema, { name: "Dupe" })),
    ).rejects.toThrow(/already exists/i);
  });

  it("updateAgent changes only provided fields and emits agent.updated", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, {
        name: "Before",
        avatar: "x",
        primaryPersonaId: "p1",
      }),
    );
    const updated = await agentHandlers.updateAgent(
      create(grackle.UpdateAgentRequestSchema, { id: created.id, name: "After" }),
    );
    expect(updated.name).toBe("After");
    // avatar left unset → preserved
    expect(updated.avatar).toBe("x");
    expect(emitMock).toHaveBeenCalledWith("agent.updated", expect.objectContaining({}));
  });

  it("deleteAgent removes the agent and emits agent.deleted", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { name: "Doomed" }),
    );
    await agentHandlers.deleteAgent(create(grackle.AgentIdSchema, { id: created.id }));
    expect(mockDb.agents.has(created.id)).toBe(false);
    expect(emitMock).toHaveBeenCalledWith("agent.deleted", expect.objectContaining({}));
  });

  it("createAgent trims whitespace from the name and stores the trimmed value", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { name: "  Trimmed  " }),
    );
    expect(created.name).toBe("Trimmed");
  });

  it("createAgent rejects a whitespace-only name", async () => {
    await expect(
      agentHandlers.createAgent(create(grackle.CreateAgentRequestSchema, { name: "   " })),
    ).rejects.toThrow(/name is required/i);
  });

  it("updateAgent rejects an explicitly-empty name (presence-tracked)", async () => {
    const created = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { name: "Keep" }),
    );
    await expect(
      agentHandlers.updateAgent(
        create(grackle.UpdateAgentRequestSchema, { id: created.id, name: "" }),
      ),
    ).rejects.toThrow(/cannot be empty/i);
    await expect(
      agentHandlers.updateAgent(
        create(grackle.UpdateAgentRequestSchema, { id: created.id, name: "   " }),
      ),
    ).rejects.toThrow(/cannot be empty/i);
  });

  it("updateAgent trims the name and rejects a name colliding with another agent", async () => {
    await agentHandlers.createAgent(create(grackle.CreateAgentRequestSchema, { name: "Taken" }));
    const other = await agentHandlers.createAgent(
      create(grackle.CreateAgentRequestSchema, { name: "Other" }),
    );
    // Trimming applies before the duplicate check.
    await expect(
      agentHandlers.updateAgent(
        create(grackle.UpdateAgentRequestSchema, { id: other.id, name: "  Taken  " }),
      ),
    ).rejects.toThrow(/already exists/i);
  });
});
