import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from "./logger.js";
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

  it("logs when Neo4j transitions from healthy to unhealthy", async () => {
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    // First tick: healthy
    await phase.execute();

    // Second tick: unhealthy
    mockHealthCheck.mockResolvedValue(false);
    await phase.execute();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
    );
    expect(vi.mocked(logger.warn).mock.calls.some(
      (call) => typeof call[0] === "string" && call[0].includes("Neo4j"),
    )).toBe(true);
  });

  it("logs warning on first check when Neo4j is unreachable", async () => {
    mockHealthCheck.mockResolvedValue(false);
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    // First tick: unhealthy (default was optimistic true → transition to false)
    await phase.execute();

    expect(vi.mocked(logger.warn).mock.calls.some(
      (call) => typeof call[0] === "string" && call[0].includes("Neo4j"),
    )).toBe(true);
  });

  it("logs when Neo4j transitions from unhealthy to healthy", async () => {
    mockHealthCheck.mockResolvedValue(false);
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    // First tick: unhealthy
    await phase.execute();
    vi.mocked(logger.info).mockClear();

    // Second tick: healthy again
    mockHealthCheck.mockResolvedValue(true);
    await phase.execute();

    expect(vi.mocked(logger.info).mock.calls.some(
      (call) => typeof call[0] === "string" && call[0].includes("Neo4j") && call[0].includes("recover"),
    )).toBe(true);
  });

  it("does NOT log on repeated healthy ticks", async () => {
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    await phase.execute();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();

    await phase.execute();
    await phase.execute();

    // No transition logs expected — only tick-level noise if any
    const transitionLogs = [
      ...vi.mocked(logger.info).mock.calls,
      ...vi.mocked(logger.warn).mock.calls,
    ].filter((call) => typeof call[0] === "string" && call[0].includes("Neo4j"));
    expect(transitionLogs).toHaveLength(0);
  });

  it("does NOT log on repeated unhealthy ticks", async () => {
    mockHealthCheck.mockResolvedValue(false);
    const phase = createKnowledgeHealthPhase({ healthCheck: mockHealthCheck });

    await phase.execute();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();

    await phase.execute();
    await phase.execute();

    const transitionLogs = [
      ...vi.mocked(logger.info).mock.calls,
      ...vi.mocked(logger.warn).mock.calls,
    ].filter((call) => typeof call[0] === "string" && call[0].includes("Neo4j"));
    expect(transitionLogs).toHaveLength(0);
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
