import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PersonaRow } from "@grackle-ai/database";

// ── Mocks ────────────────────────────────────────────────────

const kg = vi.hoisted(() => ({
  upsertReferenceNode: vi.fn().mockResolvedValue("node-1"),
  getReferenceNodeProps: vi.fn(),
  updateNode: vi.fn().mockResolvedValue(undefined),
  upsertEdge: vi.fn().mockResolvedValue(undefined),
  removeOutgoingEdges: vi.fn().mockResolvedValue(0),
  findReferenceNodeBySource: vi.fn(),
  deleteReferenceNodeBySource: vi.fn().mockResolvedValue(true),
}));
vi.mock("@grackle-ai/knowledge", () => ({
  upsertReferenceNode: kg.upsertReferenceNode,
  getReferenceNodeProps: kg.getReferenceNodeProps,
  updateNode: kg.updateNode,
  upsertEdge: kg.upsertEdge,
  removeOutgoingEdges: kg.removeOutgoingEdges,
  findReferenceNodeBySource: kg.findReferenceNodeBySource,
  deleteReferenceNodeBySource: kg.deleteReferenceNodeBySource,
  REFERENCE_SOURCE: {
    TASK: "task", WORKSPACE: "workspace", SESSION: "session",
    PERSONA: "persona", ENVIRONMENT: "environment",
  },
  EDGE_TYPE: {
    IN_WORKSPACE: "IN_WORKSPACE", PART_OF: "PART_OF", DEPENDS_ON: "DEPENDS_ON",
    ATTEMPT_OF: "ATTEMPT_OF", RAN_IN: "RAN_IN", USED_PERSONA: "USED_PERSONA",
    LINKED_TO: "LINKED_TO", SPAWNED: "SPAWNED",
  },
}));
vi.mock("@grackle-ai/database", () => ({
  workspaceEnvironmentLinkStore: { getLinkedEnvironmentIds: vi.fn(() => []) },
}));

import { projectPersona } from "./project-entity.js";

function persona(overrides: Partial<PersonaRow> = {}): PersonaRow {
  return {
    id: "p1",
    name: "Stub",
    systemPrompt: "x",
    runtime: "stub",
    model: "sonnet",
    ...overrides,
  } as unknown as PersonaRow;
}

// Exercise the shared `upsertEntityNode` path through projectPersona (the
// simplest projector — no structural edges) to verify the embedding-refresh rule.
describe("entity projection: embedding invalidation on text change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kg.upsertReferenceNode.mockResolvedValue("node-1");
  });

  it("does not clear the embedding for a brand-new node", async () => {
    kg.getReferenceNodeProps.mockResolvedValue(undefined);
    await projectPersona(persona());
    expect(kg.upsertReferenceNode).toHaveBeenCalledOnce();
    expect(kg.updateNode).not.toHaveBeenCalled();
  });

  it("clears the embedding when an existing node's projection hash changed", async () => {
    kg.getReferenceNodeProps.mockResolvedValue({ id: "node-1", projectionHash: "STALE" });
    await projectPersona(persona());
    // The stale vector is reset so the off-write-path backfill recomputes it.
    expect(kg.updateNode).toHaveBeenCalledWith("node-1", { embedding: [] });
  });

  it("leaves the embedding intact when the projection hash is unchanged", async () => {
    // Capture the hash the mapper produces on a first (create) projection…
    kg.getReferenceNodeProps.mockResolvedValue(undefined);
    await projectPersona(persona());
    const unchangedHash = (
      kg.upsertReferenceNode.mock.calls[0][0] as { extraProps?: { projectionHash?: string } }
    ).extraProps?.projectionHash;

    // …then re-project an existing node carrying that same hash → no invalidation.
    vi.clearAllMocks();
    kg.upsertReferenceNode.mockResolvedValue("node-1");
    kg.getReferenceNodeProps.mockResolvedValue({ id: "node-1", projectionHash: unchangedHash });
    await projectPersona(persona());
    expect(kg.updateNode).not.toHaveBeenCalled();
  });
});
