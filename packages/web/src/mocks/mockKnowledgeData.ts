/**
 * Mock knowledge graph data for the demo/mock mode.
 * Extracted from mockData.ts to keep files within the max-lines lint limit.
 * @module
 */

import type { GraphNode, GraphLink, NodeDetail } from "../hooks/useKnowledge.js";

// ─── Knowledge Graph ────────────────────────────────

/** Mock knowledge graph nodes representing concepts, decisions, and references discovered by agents. */
export const MOCK_KNOWLEDGE_NODES: GraphNode[] = [
  // ── Concept nodes ──
  {
    id: "kn-auth-flow",
    label: "Authentication Flow",
    kind: "knowledge",
    category: "concept",
    content: "The application uses JWT Bearer tokens for stateless authentication. Access tokens expire after 24h. Refresh tokens are stored in the database and rotated on use. The auth middleware verifies tokens and attaches the decoded payload to req.user.",
    tags: ["auth", "jwt", "security"],
    workspaceId: "proj-alpha",
    createdAt: "2026-02-25T10:30:00Z",
    updatedAt: "2026-02-27T08:15:00Z",
    val: 5,
  },
  {
    id: "kn-db-schema",
    label: "Database Schema",
    kind: "knowledge",
    category: "concept",
    content: "PostgreSQL database with tables: users, sessions, refresh_tokens, audit_log. Uses UUID primary keys, TIMESTAMPTZ for all timestamps, and JSONB for flexible metadata columns. Connection pooling via pg-pool with per-tenant isolation.",
    tags: ["database", "postgres", "schema"],
    workspaceId: "proj-alpha",
    createdAt: "2026-02-23T11:00:00Z",
    updatedAt: "2026-02-26T22:45:00Z",
    val: 4,
  },
  {
    id: "kn-error-handling",
    label: "Error Response Pattern",
    kind: "knowledge",
    category: "concept",
    content: "All API errors follow the shape { error: string, code: string, details?: unknown }. HTTP status codes map to: 400 (validation), 401 (unauthenticated), 403 (forbidden), 404 (not found), 409 (conflict), 429 (rate limited), 500 (internal).",
    tags: ["api", "errors", "patterns"],
    workspaceId: "proj-alpha",
    createdAt: "2026-02-27T08:17:00Z",
    updatedAt: "2026-02-27T08:17:00Z",
    val: 3,
  },
  {
    id: "kn-rate-limiting",
    label: "Rate Limiting Strategy",
    kind: "knowledge",
    category: "concept",
    content: "Token-bucket algorithm with in-memory state per client IP. Default rate: 100 requests/minute, burst: 20. Returns 429 with Retry-After header. Redis adapter available for multi-instance deployments.",
    tags: ["api", "rate-limiting", "infrastructure"],
    workspaceId: "proj-alpha",
    createdAt: "2026-02-27T09:00:00Z",
    updatedAt: "2026-02-27T09:00:00Z",
    val: 2,
  },
  {
    id: "kn-etl-pipeline",
    label: "ETL Pipeline Architecture",
    kind: "knowledge",
    category: "concept",
    content: "Data pipelines follow an Extract-Transform-Load pattern with pluggable stages. Each stage reads from a source (Postgres, S3, API), transforms via configurable mappers, and loads into a target (Parquet, BigQuery, S3). Incremental loads use high-watermark tracking.",
    tags: ["etl", "pipeline", "architecture"],
    workspaceId: "proj-beta",
    createdAt: "2026-02-26T08:00:00Z",
    updatedAt: "2026-02-27T09:05:00Z",
    val: 4,
  },
  {
    id: "kn-parquet-format",
    label: "Parquet Output Format",
    kind: "knowledge",
    category: "concept",
    content: "Parquet files are written with row-group buffering (configurable batch size, default 10000 rows). Supports Snappy, ZSTD, and GZIP compression. Schema is derived from the internal column type system using Arrow type mapping.",
    tags: ["parquet", "data-format", "compression"],
    workspaceId: "proj-beta",
    createdAt: "2026-02-26T08:05:00Z",
    updatedAt: "2026-02-26T08:15:00Z",
    val: 3,
  },

  // ── Decision nodes ──
  {
    id: "kn-jwt-over-session",
    label: "JWT over Session Auth",
    kind: "knowledge",
    category: "decision",
    content: "Chose JWT tokens over server-side sessions for stateless auth. Rationale: (1) no session store needed, (2) works across microservices without shared state, (3) supports mobile clients natively. Trade-off: tokens can't be revoked instantly (mitigated by short expiry + refresh rotation).",
    tags: ["auth", "decision", "jwt"],
    workspaceId: "proj-alpha",
    createdAt: "2026-02-25T10:00:00Z",
    updatedAt: "2026-02-25T10:00:00Z",
    val: 3,
  },
  {
    id: "kn-pg-pool-decision",
    label: "pg-pool over Knex",
    kind: "knowledge",
    category: "decision",
    content: "Chose pg-pool over Knex for connection pooling. pg-pool gives direct control over idle timeout, max connections, and health check queries. Knex wraps pg-pool and adds query-building overhead we don't need since we write raw SQL with parameterized queries.",
    tags: ["database", "decision", "postgres"],
    workspaceId: "proj-alpha",
    createdAt: "2026-02-23T11:30:00Z",
    updatedAt: "2026-02-23T11:30:00Z",
    val: 2,
  },
  {
    id: "kn-watermark-decision",
    label: "Local Watermark Storage",
    kind: "knowledge",
    category: "decision",
    content: "Currently using local SQLite for watermark storage. This works for single-worker pipelines but needs to move to a shared store (Redis or Postgres) for production multi-worker scenarios. Tracked as a follow-up task.",
    tags: ["pipeline", "decision", "watermarks"],
    workspaceId: "proj-beta",
    createdAt: "2026-02-27T09:05:00Z",
    updatedAt: "2026-02-27T09:05:00Z",
    val: 2,
  },

  // ── Snippet nodes ──
  {
    id: "kn-jwt-middleware",
    label: "JWT Verify Middleware",
    kind: "knowledge",
    category: "snippet",
    content: "```typescript\nexport function verifyToken(req: Request, res: Response, next: NextFunction): void {\n  const header = req.headers.authorization;\n  if (!header?.startsWith(\"Bearer \")) {\n    res.status(401).json({ error: \"Missing token\" });\n    return;\n  }\n  const decoded = jwt.verify(header.slice(7), JWT_SECRET) as JwtPayload;\n  req.user = decoded;\n  next();\n}\n```",
    tags: ["auth", "jwt", "middleware", "typescript"],
    workspaceId: "proj-alpha",
    createdAt: "2026-02-27T08:15:14Z",
    updatedAt: "2026-02-27T08:15:14Z",
    val: 2,
  },
  {
    id: "kn-audit-schema",
    label: "Audit Log Schema",
    kind: "knowledge",
    category: "snippet",
    content: "```sql\nCREATE TABLE audit_log (\n  id BIGSERIAL PRIMARY KEY,\n  user_id UUID REFERENCES users(id),\n  action TEXT NOT NULL,\n  entity_type TEXT NOT NULL,\n  entity_id TEXT NOT NULL,\n  old_value JSONB,\n  new_value JSONB,\n  ip_address INET,\n  created_at TIMESTAMPTZ DEFAULT now()\n);\n```",
    tags: ["database", "audit", "schema", "sql"],
    workspaceId: "proj-alpha",
    createdAt: "2026-02-26T22:45:15Z",
    updatedAt: "2026-02-26T22:45:15Z",
    val: 2,
  },

  // ── Insight nodes ──
  {
    id: "kn-n1-query",
    label: "N+1 Query in User List",
    kind: "knowledge",
    category: "insight",
    content: "GET /api/users performs a separate query for each user's role metadata, resulting in N+1 queries. For 500 users this adds ~2 seconds of latency. Solution: use a JOIN or batch lookup to fetch all role data in a single query.",
    tags: ["performance", "database", "n+1"],
    workspaceId: "proj-alpha",
    createdAt: "2026-02-22T09:30:00Z",
    updatedAt: "2026-02-22T09:30:00Z",
    val: 2,
  },
  {
    id: "kn-session-race",
    label: "Session Cleanup Race Condition",
    kind: "knowledge",
    category: "insight",
    content: "When two concurrent requests hit /api/logout, the second call throws a 500 because the session row has already been deleted. Fix: use DELETE ... RETURNING or add IF EXISTS guard to make the operation idempotent.",
    tags: ["bug", "concurrency", "sessions"],
    workspaceId: "proj-alpha",
    createdAt: "2026-02-26T22:50:00Z",
    updatedAt: "2026-02-26T22:50:00Z",
    val: 2,
  },

  // ── Reference nodes (link to tasks/sessions) ──
  {
    id: "kn-ref-task-001",
    label: "JWT Auth Task",
    kind: "reference",
    sourceType: "task",
    sourceId: "task-001",
    content: "Implement JWT authentication across all protected routes, replacing session-based auth.",
    workspaceId: "proj-alpha",
    createdAt: "2026-02-25T10:00:00Z",
    updatedAt: "2026-02-27T08:15:00Z",
    val: 3,
  },
  {
    id: "kn-ref-task-006",
    label: "Parquet Export Task",
    kind: "reference",
    sourceType: "task",
    sourceId: "task-006",
    content: "Add Parquet export support for pipeline outputs, enabling downstream Spark consumption.",
    workspaceId: "proj-beta",
    createdAt: "2026-02-26T08:00:00Z",
    updatedAt: "2026-02-27T09:00:00Z",
    val: 3,
  },
  {
    id: "kn-ref-sess-001",
    label: "Auth Middleware Session",
    kind: "reference",
    sourceType: "session",
    sourceId: "sess-001",
    content: "Active session implementing JWT auth middleware, rewrote auth.ts, login.ts, and test suite.",
    workspaceId: "proj-alpha",
    createdAt: "2026-02-27T08:15:00Z",
    updatedAt: "2026-02-27T08:15:42Z",
    val: 2,
  },
];

/** Mock knowledge graph edges connecting nodes. */
export const MOCK_KNOWLEDGE_LINKS: GraphLink[] = [
  // Auth flow connections
  { source: "kn-auth-flow", target: "kn-jwt-over-session", type: "decided_by" },
  { source: "kn-auth-flow", target: "kn-jwt-middleware", type: "implemented_by" },
  { source: "kn-auth-flow", target: "kn-ref-task-001", type: "tracked_in" },
  { source: "kn-auth-flow", target: "kn-error-handling", type: "relates_to" },
  { source: "kn-jwt-over-session", target: "kn-ref-task-001", type: "motivated_by" },

  // Database connections
  { source: "kn-db-schema", target: "kn-pg-pool-decision", type: "decided_by" },
  { source: "kn-db-schema", target: "kn-audit-schema", type: "contains" },
  { source: "kn-db-schema", target: "kn-n1-query", type: "affected_by" },
  { source: "kn-db-schema", target: "kn-session-race", type: "affected_by" },

  // Rate limiting connections
  { source: "kn-rate-limiting", target: "kn-error-handling", type: "relates_to" },
  { source: "kn-rate-limiting", target: "kn-auth-flow", type: "depends_on" },

  // ETL pipeline connections
  { source: "kn-etl-pipeline", target: "kn-parquet-format", type: "outputs_to" },
  { source: "kn-etl-pipeline", target: "kn-watermark-decision", type: "decided_by" },
  { source: "kn-etl-pipeline", target: "kn-ref-task-006", type: "tracked_in" },
  { source: "kn-parquet-format", target: "kn-ref-task-006", type: "tracked_in" },
  { source: "kn-watermark-decision", target: "kn-etl-pipeline", type: "relates_to" },

  // Reference connections
  { source: "kn-ref-task-001", target: "kn-ref-sess-001", type: "has_session" },
  { source: "kn-jwt-middleware", target: "kn-ref-sess-001", type: "created_in" },
  { source: "kn-audit-schema", target: "kn-db-schema", type: "part_of" },
];

/** Lookup map for knowledge nodes by ID. */
const knowledgeNodeById: Map<string, GraphNode> = new Map(MOCK_KNOWLEDGE_NODES.map((n) => [n.id, n]));

/** Helper to get a knowledge node by ID, throwing if not found (catches typos at startup). */
function getNode(id: string): GraphNode {
  const node = knowledgeNodeById.get(id);
  if (!node) {
    throw new Error(`MOCK_KNOWLEDGE_NODES is missing node "${id}"`);
  }
  return node;
}

/**
 * Pre-built detail data for knowledge nodes, keyed by node ID.
 * Used by the mock provider to populate the detail panel on node selection.
 */
export const MOCK_KNOWLEDGE_DETAILS: Record<string, NodeDetail> = {
  "kn-auth-flow": {
    node: getNode("kn-auth-flow"),
    edges: [
      { fromId: "kn-auth-flow", toId: "kn-jwt-over-session", type: "decided_by" },
      { fromId: "kn-auth-flow", toId: "kn-jwt-middleware", type: "implemented_by" },
      { fromId: "kn-auth-flow", toId: "kn-ref-task-001", type: "tracked_in" },
      { fromId: "kn-auth-flow", toId: "kn-error-handling", type: "relates_to" },
      { fromId: "kn-rate-limiting", toId: "kn-auth-flow", type: "depends_on" },
    ],
  },
  "kn-db-schema": {
    node: getNode("kn-db-schema"),
    edges: [
      { fromId: "kn-db-schema", toId: "kn-pg-pool-decision", type: "decided_by" },
      { fromId: "kn-db-schema", toId: "kn-audit-schema", type: "contains" },
      { fromId: "kn-db-schema", toId: "kn-n1-query", type: "affected_by" },
      { fromId: "kn-db-schema", toId: "kn-session-race", type: "affected_by" },
      { fromId: "kn-audit-schema", toId: "kn-db-schema", type: "part_of" },
    ],
  },
  "kn-etl-pipeline": {
    node: getNode("kn-etl-pipeline"),
    edges: [
      { fromId: "kn-etl-pipeline", toId: "kn-parquet-format", type: "outputs_to" },
      { fromId: "kn-etl-pipeline", toId: "kn-watermark-decision", type: "decided_by" },
      { fromId: "kn-etl-pipeline", toId: "kn-ref-task-006", type: "tracked_in" },
      { fromId: "kn-watermark-decision", toId: "kn-etl-pipeline", type: "relates_to" },
    ],
  },
};
