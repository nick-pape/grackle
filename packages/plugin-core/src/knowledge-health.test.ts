import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

import { logger } from "@grackle-ai/core";
import {
  createKnowledgeHealthPhase,
  isNeo4jHealthy,
  getKnowledgeReadinessCheck,
  resetKnowledgeHealthState,
} from "./knowledge-health.js";

describe("createKnowledgeHealthPhase", () => {
  let mockHealthCheck: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetKnowledgeHealthState();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.info).mockClear();
    mockHealthCheck = vi.fn().mockResolvedValue(true);
  });

  it("has the name 'knowledge-health'", () => {
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });
    expect(phase.name).toBe("knowledge-health");
  });

  it("calls healthCheck on each execute", async () => {
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    await phase.execute();
    await phase.execute();

    expect(mockHealthCheck).toHaveBeenCalledTimes(2);
  });

  it("sets isNeo4jHealthy to true when healthCheck returns true", async () => {
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    await phase.execute();

    expect(isNeo4jHealthy()).toBe(true);
  });

  it("sets isNeo4jHealthy to false when healthCheck returns false", async () => {
    mockHealthCheck.mockResolvedValue(false);
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    await phase.execute();

    expect(isNeo4jHealthy()).toBe(false);
  });

  it("transitions from healthy to unhealthy", async () => {
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    // First tick: healthy
    await phase.execute();
    expect(isNeo4jHealthy()).toBe(true);

    // Second tick: unhealthy
    mockHealthCheck.mockResolvedValue(false);
    await phase.execute();
    expect(isNeo4jHealthy()).toBe(false);
  });

  it("marks unhealthy on first check when Neo4j is unreachable", async () => {
    mockHealthCheck.mockResolvedValue(false);
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    // First tick: unhealthy (default was optimistic true -> transition to false)
    await phase.execute();
    expect(isNeo4jHealthy()).toBe(false);
  });

  it("transitions from unhealthy to healthy", async () => {
    mockHealthCheck.mockResolvedValue(false);
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    // First tick: unhealthy
    await phase.execute();
    expect(isNeo4jHealthy()).toBe(false);

    // Second tick: healthy again
    mockHealthCheck.mockResolvedValue(true);
    await phase.execute();
    expect(isNeo4jHealthy()).toBe(true);
  });

  it("stays healthy on repeated healthy ticks", async () => {
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    await phase.execute();
    await phase.execute();
    await phase.execute();

    expect(isNeo4jHealthy()).toBe(true);
  });

  it("stays unhealthy on repeated unhealthy ticks", async () => {
    mockHealthCheck.mockResolvedValue(false);
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    await phase.execute();
    await phase.execute();
    await phase.execute();

    expect(isNeo4jHealthy()).toBe(false);
  });

  it("handles healthCheck throwing an error as unhealthy", async () => {
    mockHealthCheck.mockRejectedValue(new Error("connection refused"));
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    await phase.execute();

    expect(isNeo4jHealthy()).toBe(false);
  });
});

describe("isNeo4jHealthy", () => {
  beforeEach(() => {
    resetKnowledgeHealthState();
  });

  it("returns true before any health check has run (optimistic default)", () => {
    expect(isNeo4jHealthy()).toBe(true);
  });
});

describe("getKnowledgeReadinessCheck", () => {
  beforeEach(() => {
    resetKnowledgeHealthState();
  });

  it("returns ok: true before any health check has run (optimistic default)", () => {
    const check = getKnowledgeReadinessCheck();
    expect(check.ok).toBe(true);
    expect(check.message).toBeDefined();
  });

  it("returns ok: true when Neo4j is healthy", async () => {
    const phase = createKnowledgeHealthPhase({
      healthCheck: vi.fn().mockResolvedValue(true),
    });
    await phase.execute();

    const check = getKnowledgeReadinessCheck();
    expect(check.ok).toBe(true);
    expect(check.message).toBeUndefined();
  });

  it("returns ok: false with message when Neo4j is unhealthy", async () => {
    const phase = createKnowledgeHealthPhase({
      healthCheck: vi.fn().mockResolvedValue(false),
    });
    await phase.execute();

    const check = getKnowledgeReadinessCheck();
    expect(check.ok).toBe(false);
    expect(check.message).toContain("Neo4j");
  });
});
