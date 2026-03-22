import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock dependencies — use vi.hoisted() so variables are available in the
// hoisted vi.mock() factory.
// ---------------------------------------------------------------------------

const { mockSessionRun, mockSessionClose, mockSession } = vi.hoisted(() => {
  const mockSessionRun = vi.fn().mockResolvedValue({ records: [] });
  const mockSessionClose = vi.fn().mockResolvedValue(undefined);
  const mockSession = {
    run: mockSessionRun,
    close: mockSessionClose,
  };
  return { mockSessionRun, mockSessionClose, mockSession };
});

vi.mock("./client.js", () => ({
  getSession: vi.fn(() => mockSession),
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { initSchema, SCHEMA_STATEMENTS } from "./schema.js";
import {
  VECTOR_INDEX_NAME,
  EMBEDDING_DIMENSIONS,
  VECTOR_SIMILARITY_FUNCTION,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SCHEMA_STATEMENTS", () => {
  it("has all expected schema keys", () => {
    const keys = Object.keys(SCHEMA_STATEMENTS);
    expect(keys).toContain("UNIQUE_NODE_ID");
    expect(keys).toContain("INDEX_KIND");
    expect(keys).toContain("INDEX_WORKSPACE");
    expect(keys).toContain("INDEX_SOURCE");
    expect(keys).toContain("VECTOR_INDEX");
  });

  it("all statements use IF NOT EXISTS for idempotency", () => {
    for (const [, cypher] of Object.entries(SCHEMA_STATEMENTS)) {
      expect(cypher.toUpperCase()).toContain("IF NOT EXISTS");
    }
  });

  it("vector index references the correct index name", () => {
    expect(SCHEMA_STATEMENTS.VECTOR_INDEX).toContain(VECTOR_INDEX_NAME);
  });

  it("vector index specifies the configured dimensions", () => {
    expect(SCHEMA_STATEMENTS.VECTOR_INDEX).toContain(
      String(EMBEDDING_DIMENSIONS),
    );
  });

  it("vector index uses the configured similarity function", () => {
    expect(SCHEMA_STATEMENTS.VECTOR_INDEX).toContain(
      VECTOR_SIMILARITY_FUNCTION,
    );
  });
});

describe("initSchema", () => {
  beforeEach(() => {
    mockSessionRun.mockClear();
    mockSessionClose.mockClear();
  });

  it("runs all schema statements", async () => {
    await initSchema();

    const statementCount = Object.keys(SCHEMA_STATEMENTS).length;
    expect(mockSessionRun).toHaveBeenCalledTimes(statementCount);

    // Verify each Cypher string was passed to session.run()
    const executedStatements = mockSessionRun.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    for (const cypher of Object.values(SCHEMA_STATEMENTS)) {
      expect(executedStatements).toContain(cypher);
    }
  });

  it("closes the session after success", async () => {
    await initSchema();
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });

  it("closes the session even when a statement fails", async () => {
    mockSessionRun.mockRejectedValueOnce(new Error("syntax error"));

    await expect(initSchema()).rejects.toThrow("syntax error");
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });
});
