/**
 * Static mock data for visual testing (`?mock` mode).
 *
 * Provides realistic sample entities that exercise every UI state:
 * multiple environments, sessions in various statuses, projects with
 * tasks at different lifecycle stages, and findings across all categories.
 */

import type {
  Environment,
  Session,
  SessionEvent,
  Project,
  TaskData,
  FindingData,
  TokenInfo,
} from "../hooks/useGrackleSocket.js";

// ─── Environments ───────────────────────────────────

/** Sample environments covering different adapter types and statuses. */
export const MOCK_ENVIRONMENTS: Environment[] = [
  {
    id: "env-local-01",
    displayName: "Local Dev",
    adapterType: "local",
    defaultRuntime: "claude-code",
    status: "connected",
    bootstrapped: true,
  },
  {
    id: "env-docker-01",
    displayName: "Docker Sandbox",
    adapterType: "docker",
    defaultRuntime: "claude-code",
    status: "connected",
    bootstrapped: true,
  },
  {
    id: "env-cs-01",
    displayName: "GitHub Codespace",
    adapterType: "codespace",
    defaultRuntime: "claude-code",
    status: "connected",
    bootstrapped: true,
  },
  {
    id: "env-remote-01",
    displayName: "Staging (SSH)",
    adapterType: "ssh",
    defaultRuntime: "claude-code",
    status: "disconnected",
    bootstrapped: false,
  },
];

// ─── Sessions ───────────────────────────────────────

/** Sample sessions spanning active, completed, and failed states. */
export const MOCK_SESSIONS: Session[] = [
  {
    id: "sess-001",
    environmentId: "env-local-01",
    runtime: "node",
    status: "running",
    prompt: "Refactor the authentication middleware to use JWT tokens",
    startedAt: "2026-02-27T08:15:00Z",
  },
  {
    id: "sess-002",
    environmentId: "env-docker-01",
    runtime: "python",
    status: "completed",
    prompt: "Write unit tests for the user registration endpoint",
    startedAt: "2026-02-27T07:30:00Z",
  },
  {
    id: "sess-003",
    environmentId: "env-local-01",
    runtime: "node",
    status: "failed",
    prompt: "Migrate database schema to add audit_log table",
    startedAt: "2026-02-26T22:45:00Z",
  },
  {
    id: "sess-004",
    environmentId: "env-docker-01",
    runtime: "python",
    status: "running",
    prompt: "Implement rate limiting for the public API",
    startedAt: "2026-02-27T09:00:00Z",
  },
];

// ─── Session Events ─────────────────────────────────

/** Sample events for the first running session to populate the event stream. */
export const MOCK_EVENTS: SessionEvent[] = [
  {
    sessionId: "sess-001",
    eventType: "status",
    timestamp: "2026-02-27T08:15:01Z",
    content: "running",
  },
  {
    sessionId: "sess-001",
    eventType: "output",
    timestamp: "2026-02-27T08:15:02Z",
    content: "Analyzing current authentication middleware in src/middleware/auth.ts...",
  },
  {
    sessionId: "sess-001",
    eventType: "output",
    timestamp: "2026-02-27T08:15:04Z",
    content:
      "Found 3 files using session-based auth:\n  - src/middleware/auth.ts\n  - src/routes/login.ts\n  - src/routes/protected.ts",
  },
  {
    sessionId: "sess-001",
    eventType: "output",
    timestamp: "2026-02-27T08:15:07Z",
    content: "Installing jsonwebtoken and @types/jsonwebtoken...",
  },
  {
    sessionId: "sess-001",
    eventType: "output",
    timestamp: "2026-02-27T08:15:12Z",
    content:
      'Rewriting auth middleware:\n```typescript\nimport jwt from "jsonwebtoken";\nimport type { Request, Response, NextFunction } from "express";\n\nconst JWT_SECRET = process.env.JWT_SECRET || "change-me";\n\nexport function verifyToken(req: Request, res: Response, next: NextFunction): void {\n  const header = req.headers.authorization;\n  if (!header?.startsWith("Bearer ")) {\n    res.status(401).json({ error: "Missing token" });\n    return;\n  }\n  try {\n    const decoded = jwt.verify(header.slice(7), JWT_SECRET);\n    req.user = decoded;\n    next();\n  } catch {\n    res.status(403).json({ error: "Invalid token" });\n  }\n}\n```',
  },
  {
    sessionId: "sess-001",
    eventType: "output",
    timestamp: "2026-02-27T08:15:18Z",
    content: "Updated login route to issue JWT tokens with 24h expiry.",
  },
  {
    sessionId: "sess-001",
    eventType: "output",
    timestamp: "2026-02-27T08:15:22Z",
    content: "Running test suite... 14 tests passed, 2 updated, 0 failed.",
  },
  // Events for the completed session
  {
    sessionId: "sess-002",
    eventType: "status",
    timestamp: "2026-02-27T07:30:01Z",
    content: "running",
  },
  {
    sessionId: "sess-002",
    eventType: "output",
    timestamp: "2026-02-27T07:30:05Z",
    content: "Generating pytest tests for POST /api/register endpoint...",
  },
  {
    sessionId: "sess-002",
    eventType: "output",
    timestamp: "2026-02-27T07:32:00Z",
    content: "Created 8 test cases covering: valid registration, duplicate email, weak password, missing fields, SQL injection, XSS payload, rate limit, and CORS headers.",
  },
  {
    sessionId: "sess-002",
    eventType: "status",
    timestamp: "2026-02-27T07:33:00Z",
    content: "completed",
  },
];

// ─── Projects ───────────────────────────────────────

/** Sample projects at different lifecycle stages. */
export const MOCK_PROJECTS: Project[] = [
  {
    id: "proj-alpha",
    name: "Project Alpha",
    description: "Core platform API and authentication services",
    repoUrl: "https://github.com/acme/alpha",
    defaultEnvironmentId: "env-local-01",
    status: "active",
    createdAt: "2026-01-15T10:00:00Z",
  },
  {
    id: "proj-beta",
    name: "Data Pipeline",
    description: "ETL pipelines for analytics and reporting",
    repoUrl: "https://github.com/acme/data-pipeline",
    defaultEnvironmentId: "env-docker-01",
    status: "active",
    createdAt: "2026-02-01T14:30:00Z",
  },
  {
    id: "proj-gamma",
    name: "Mobile App",
    description: "React Native cross-platform mobile application",
    repoUrl: "",
    defaultEnvironmentId: "env-local-01",
    status: "archived",
    createdAt: "2025-11-20T09:00:00Z",
  },
];

// ─── Tasks ──────────────────────────────────────────

/** Sample tasks demonstrating every status in the lifecycle, including parent/child hierarchy. */
export const MOCK_TASKS: TaskData[] = [
  // ── Root tasks for proj-alpha ──────────────────────
  {
    id: "task-001",
    projectId: "proj-alpha",
    title: "Implement JWT authentication",
    description: "Replace session-based auth with JWT tokens across all protected routes",
    status: "in_progress",
    branch: "feat/jwt-auth",
    environmentId: "env-local-01",
    sessionId: "sess-001",
    dependsOn: [],
    reviewNotes: "",
    sortOrder: 1,
    createdAt: "2026-02-25T10:00:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: ["task-001a", "task-001b", "task-001c"],
    canDecompose: true,
    personaId: "",
  },
  // ── Children of task-001 ───────────────────────────
  {
    id: "task-001a",
    projectId: "proj-alpha",
    title: "Design token schema",
    description: "Define JWT payload structure, expiry, and refresh token strategy",
    status: "done",
    branch: "feat/jwt-auth/design-token-schema",
    environmentId: "env-local-01",
    sessionId: "",
    dependsOn: [],
    reviewNotes: "",
    sortOrder: 1,
    createdAt: "2026-02-25T10:10:00Z",
    parentTaskId: "task-001",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  {
    id: "task-001b",
    projectId: "proj-alpha",
    title: "Implement auth middleware",
    description: "Build Express middleware that verifies JWT Bearer tokens",
    status: "in_progress",
    branch: "feat/jwt-auth/implement-auth-middleware",
    environmentId: "env-local-01",
    sessionId: "sess-001",
    dependsOn: [],
    reviewNotes: "",
    sortOrder: 2,
    createdAt: "2026-02-25T10:15:00Z",
    parentTaskId: "task-001",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  {
    id: "task-001c",
    projectId: "proj-alpha",
    title: "Write auth integration tests",
    description: "End-to-end tests for login flow, token refresh, and protected route access",
    status: "pending",
    branch: "",
    environmentId: "env-local-01",
    sessionId: "",
    dependsOn: ["task-001b"],
    reviewNotes: "",
    sortOrder: 3,
    createdAt: "2026-02-25T10:20:00Z",
    parentTaskId: "task-001",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  // ── Remaining root tasks for proj-alpha ────────────
  {
    id: "task-002",
    projectId: "proj-alpha",
    title: "Add rate limiting",
    description: "Implement token-bucket rate limiting for public API endpoints",
    status: "pending",
    branch: "",
    environmentId: "env-local-01",
    sessionId: "",
    dependsOn: ["task-001"],
    reviewNotes: "",
    sortOrder: 2,
    createdAt: "2026-02-25T10:05:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  {
    id: "task-003",
    projectId: "proj-alpha",
    title: "Set up OpenAPI documentation",
    description: "Generate Swagger docs from route decorators and serve at /api/docs",
    status: "review",
    branch: "feat/openapi-docs",
    environmentId: "env-local-01",
    sessionId: "sess-002",
    dependsOn: [],
    reviewNotes: "",
    sortOrder: 3,
    createdAt: "2026-02-24T16:00:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  {
    id: "task-004",
    projectId: "proj-alpha",
    title: "Database connection pooling",
    description: "Switch from single connection to a connection pool with health checks",
    status: "done",
    branch: "feat/db-pool",
    environmentId: "env-local-01",
    sessionId: "",
    dependsOn: [],
    reviewNotes: "LGTM — pool size and idle timeout values are sensible.",
    sortOrder: 4,
    createdAt: "2026-02-23T11:00:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  {
    id: "task-005",
    projectId: "proj-alpha",
    title: "Fix N+1 query in user list",
    description: "Use a JOIN instead of per-row lookups in GET /api/users",
    status: "assigned",
    branch: "fix/user-list-n1",
    environmentId: "env-local-01",
    sessionId: "",
    dependsOn: [],
    reviewNotes: "The fix breaks pagination — cursor should reference the joined table, not the subquery.",
    sortOrder: 5,
    createdAt: "2026-02-22T09:30:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  // ── Tasks for proj-beta ────────────────────────────
  {
    id: "task-006",
    projectId: "proj-beta",
    title: "Add Parquet export support",
    description: "Allow pipeline outputs to be written as Parquet files for Spark consumption",
    status: "in_progress",
    branch: "feat/parquet-export",
    environmentId: "env-docker-01",
    sessionId: "",
    dependsOn: [],
    reviewNotes: "",
    sortOrder: 1,
    createdAt: "2026-02-26T08:00:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: ["task-006a", "task-006b", "task-006c", "task-006d"],
    canDecompose: true,
    personaId: "",
  },
  // ── Children of task-006 ───────────────────────────
  {
    id: "task-006a",
    projectId: "proj-beta",
    title: "Define Parquet schema mapping",
    description: "Map internal column types to Arrow/Parquet type system",
    status: "done",
    branch: "feat/parquet-export/define-parquet-schema-mapping",
    environmentId: "env-docker-01",
    sessionId: "",
    dependsOn: [],
    reviewNotes: "",
    sortOrder: 1,
    createdAt: "2026-02-26T08:05:00Z",
    parentTaskId: "task-006",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  {
    id: "task-006b",
    projectId: "proj-beta",
    title: "Implement row-group writer",
    description: "Write buffered row groups with configurable batch size",
    status: "done",
    branch: "feat/parquet-export/implement-row-group-writer",
    environmentId: "env-docker-01",
    sessionId: "",
    dependsOn: ["task-006a"],
    reviewNotes: "",
    sortOrder: 2,
    createdAt: "2026-02-26T08:10:00Z",
    parentTaskId: "task-006",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  {
    id: "task-006c",
    projectId: "proj-beta",
    title: "Add compression options",
    description: "Support Snappy, ZSTD, and GZIP compression for Parquet output",
    status: "in_progress",
    branch: "feat/parquet-export/add-compression-options",
    environmentId: "env-docker-01",
    sessionId: "sess-004",
    dependsOn: ["task-006b"],
    reviewNotes: "",
    sortOrder: 3,
    createdAt: "2026-02-26T08:15:00Z",
    parentTaskId: "task-006",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  {
    id: "task-006d",
    projectId: "proj-beta",
    title: "Write Parquet integration tests",
    description: "Round-trip tests: write Parquet, read back with pyarrow, verify data integrity",
    status: "pending",
    branch: "",
    environmentId: "env-docker-01",
    sessionId: "",
    dependsOn: ["task-006c"],
    reviewNotes: "",
    sortOrder: 4,
    createdAt: "2026-02-26T08:20:00Z",
    parentTaskId: "task-006",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  // ── Remaining root tasks for proj-beta ─────────────
  {
    id: "task-007",
    projectId: "proj-beta",
    title: "Implement incremental loads",
    description: "Track watermarks so pipelines only process new/changed rows",
    status: "in_progress",
    branch: "feat/incremental",
    environmentId: "env-docker-01",
    sessionId: "sess-004",
    dependsOn: [],
    reviewNotes: "",
    sortOrder: 2,
    createdAt: "2026-02-26T08:30:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: ["task-007a", "task-007b"],
    canDecompose: true,
    personaId: "",
  },
  // ── Children of task-007 ───────────────────────────
  {
    id: "task-007a",
    projectId: "proj-beta",
    title: "Design watermark storage",
    description: "Define schema for per-pipeline high-watermark tracking",
    status: "done",
    branch: "feat/incremental/design-watermark-storage",
    environmentId: "env-docker-01",
    sessionId: "",
    dependsOn: [],
    reviewNotes: "",
    sortOrder: 1,
    createdAt: "2026-02-26T08:35:00Z",
    parentTaskId: "task-007",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  {
    id: "task-007b",
    projectId: "proj-beta",
    title: "Implement change detection query",
    description: "Generate WHERE clauses from watermarks to fetch only changed rows",
    status: "failed",
    branch: "feat/incremental/implement-change-detection-query",
    environmentId: "env-docker-01",
    sessionId: "",
    dependsOn: ["task-007a"],
    reviewNotes: "Query fails on tables without a monotonic primary key",
    sortOrder: 2,
    createdAt: "2026-02-26T08:40:00Z",
    parentTaskId: "task-007",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
  {
    id: "task-008",
    projectId: "proj-beta",
    title: "Add pipeline monitoring dashboard",
    description: "Real-time metrics for pipeline throughput, latency, and error rates",
    status: "review",
    branch: "feat/monitoring",
    environmentId: "env-docker-01",
    sessionId: "",
    dependsOn: [],
    reviewNotes: "",
    sortOrder: 3,
    createdAt: "2026-02-26T09:00:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    personaId: "",
  },
];

// ─── Findings ───────────────────────────────────────

/** Sample findings across every category to exercise the FindingsPanel styling. */
export const MOCK_FINDINGS: FindingData[] = [
  {
    id: "find-001",
    projectId: "proj-alpha",
    taskId: "task-001",
    sessionId: "sess-001",
    category: "architecture",
    title: "Auth middleware is tightly coupled to Express",
    content:
      "The current auth middleware directly references Express Request/Response types. Consider extracting a framework-agnostic token verification layer so we can reuse it in the WebSocket auth path.",
    tags: ["auth", "decoupling", "middleware"],
    createdAt: "2026-02-27T08:16:00Z",
  },
  {
    id: "find-002",
    projectId: "proj-alpha",
    taskId: "task-003",
    sessionId: "sess-002",
    category: "api",
    title: "Missing pagination on GET /api/users",
    content:
      "The users endpoint returns all rows without limit/offset. For datasets over 10k rows this will cause timeouts. Recommend cursor-based pagination with a default page size of 50.",
    tags: ["api", "pagination", "performance"],
    createdAt: "2026-02-27T07:31:00Z",
  },
  {
    id: "find-003",
    projectId: "proj-alpha",
    taskId: "task-005",
    sessionId: "sess-003",
    category: "bug",
    title: "Race condition in session cleanup",
    content:
      "When two requests hit /api/logout concurrently, the second call throws a 500 because the session row has already been deleted. Needs an idempotent DELETE or a conditional check.",
    tags: ["bug", "concurrency", "sessions"],
    createdAt: "2026-02-26T22:50:00Z",
  },
  {
    id: "find-004",
    projectId: "proj-alpha",
    taskId: "task-004",
    sessionId: "",
    category: "decision",
    title: "Chose pg-pool over knex connection pool",
    content:
      "pg-pool gives us direct control over idle timeout, max connections, and health check queries. Knex wraps pg-pool anyway and adds overhead we don't need since we write raw SQL.",
    tags: ["database", "decision", "postgres"],
    createdAt: "2026-02-23T11:30:00Z",
  },
  {
    id: "find-005",
    projectId: "proj-alpha",
    taskId: "",
    sessionId: "",
    category: "dependency",
    title: "jsonwebtoken has 3 high-severity CVEs",
    content:
      "The jsonwebtoken package (v8.x) has known vulnerabilities. Consider migrating to jose which is maintained, supports ESM, and covers the same JWS/JWE surface area with zero dependencies.",
    tags: ["security", "dependency", "jwt"],
    createdAt: "2026-02-27T08:20:00Z",
  },
  {
    id: "find-006",
    projectId: "proj-alpha",
    taskId: "task-001",
    sessionId: "sess-001",
    category: "pattern",
    title: "Consistent error response shape",
    content:
      'All error responses should follow the shape `{ error: string, code: string, details?: unknown }`. Currently some routes return `{ message: string }` and others return `{ error: string }`.',
    tags: ["api", "consistency", "error-handling"],
    createdAt: "2026-02-27T08:17:00Z",
  },
  {
    id: "find-007",
    projectId: "proj-beta",
    taskId: "task-007",
    sessionId: "sess-004",
    category: "architecture",
    title: "Watermark storage should be pluggable",
    content:
      "The incremental load watermarks are currently stored in a local SQLite file. For production multi-worker scenarios, this needs to be backed by a shared store (Redis or Postgres).",
    tags: ["architecture", "pipeline", "scalability"],
    createdAt: "2026-02-27T09:05:00Z",
  },
];

// ─── Tokens ──────────────────────────────────────────

/** Sample tokens for the settings panel. */
export const MOCK_TOKENS: TokenInfo[] = [
  {
    name: "anthropic",
    tokenType: "env_var",
    envVar: "ANTHROPIC_API_KEY",
    filePath: "",
    expiresAt: "",
  },
  {
    name: "github",
    tokenType: "env_var",
    envVar: "GITHUB_TOKEN",
    filePath: "",
    expiresAt: "2026-12-31T23:59:59Z",
  },
  {
    name: "gcp-service-account",
    tokenType: "file",
    envVar: "",
    filePath: "/home/user/.config/gcloud/credentials.json",
    expiresAt: "",
  },
];

// ─── Stream Scenarios ───────────────────────────────

/**
 * A single step in a mock event stream, describing the delay before
 * emitting and the event content (without sessionId, which is assigned
 * at playback time).
 */
export interface MockStreamStep {
  /** Milliseconds to wait before emitting this event. */
  delayMs: number;
  /** The event to emit (sessionId is filled in at playback time). */
  event: Omit<SessionEvent, "sessionId">;
}

/**
 * A complete mock stream scenario describing a sequence of events,
 * optionally pausing midway through to wait for user input.
 */
export interface MockStreamScenario {
  /** Human-readable label for console logging. */
  label: string;
  /** Whether the scenario pauses for user input partway through. */
  pauseForInput: boolean;
  /** Step index after which to pause (only when pauseForInput is true). */
  pauseAfterStep?: number;
  /** Steps to play after the user provides input. */
  resumeSteps?: MockStreamStep[];
  /** The main sequence of steps. */
  steps: MockStreamStep[];
}

/** Timestamp helper that returns an ISO string offset from "now". */
function ts(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/**
 * Pre-built scenarios that exercise different UI paths:
 * - Scenario A: straight-through to "completed" (no pause)
 * - Scenario B: pauses at "waiting_input" for user confirmation, then resumes
 * - Scenario C: runs partway then hits an error and ends in "failed"
 */
export const MOCK_STREAM_SCENARIOS: MockStreamScenario[] = [
  // ── Scenario A — API Refactor (straight-through) ──────
  {
    label: "API Refactor",
    pauseForInput: false,
    steps: [
      {
        delayMs: 0,
        event: { eventType: "status", timestamp: ts(0), content: "running" },
      },
      {
        delayMs: 800,
        event: {
          eventType: "output",
          timestamp: ts(800),
          content: "Analyzing current API structure in src/routes/...",
        },
      },
      {
        delayMs: 1600,
        event: {
          eventType: "output",
          timestamp: ts(1600),
          content: "Found 5 endpoints that need refactoring:\n  - GET /api/users\n  - POST /api/users\n  - GET /api/users/:id\n  - PUT /api/users/:id\n  - DELETE /api/users/:id",
        },
      },
      {
        delayMs: 2800,
        event: {
          eventType: "output",
          timestamp: ts(2800),
          content: "Refactoring to use Express Router with middleware chain...\n```typescript\nconst router = Router();\nrouter.use(authenticate);\nrouter.use(validateBody);\n```",
        },
      },
      {
        delayMs: 4000,
        event: {
          eventType: "output",
          timestamp: ts(4000),
          content: "Running test suite... 22 tests passed, 3 updated, 0 failed.",
        },
      },
      {
        delayMs: 5000,
        event: { eventType: "status", timestamp: ts(5000), content: "completed" },
      },
    ],
  },

  // ── Scenario B — Database Migration (pause for input) ─
  {
    label: "Database Migration",
    pauseForInput: true,
    pauseAfterStep: 3,
    steps: [
      {
        delayMs: 0,
        event: { eventType: "status", timestamp: ts(0), content: "running" },
      },
      {
        delayMs: 600,
        event: {
          eventType: "output",
          timestamp: ts(600),
          content: "Scanning current schema for migration targets...",
        },
      },
      {
        delayMs: 1400,
        event: {
          eventType: "output",
          timestamp: ts(1400),
          content: "Found tables to modify:\n  - users (add column: last_login_at)\n  - sessions (add index on expires_at)\n  - audit_log (new table)",
        },
      },
      {
        delayMs: 2200,
        event: {
          eventType: "output",
          timestamp: ts(2200),
          content: "⚠ This migration will add a NOT NULL column to the users table.\nThe table has 50,000+ rows — this may lock the table briefly.\n\nPlease confirm to proceed.",
        },
      },
      // step index 3 is the last step before pause
      // After this, session goes to "waiting_input"
    ],
    resumeSteps: [
      {
        delayMs: 500,
        event: {
          eventType: "output",
          timestamp: ts(0),
          content: "Proceeding with migration...",
        },
      },
      {
        delayMs: 1500,
        event: {
          eventType: "output",
          timestamp: ts(1000),
          content: "Migration 001_add_last_login.sql applied successfully.\nMigration 002_sessions_index.sql applied successfully.\nMigration 003_audit_log.sql applied successfully.",
        },
      },
      {
        delayMs: 2500,
        event: {
          eventType: "output",
          timestamp: ts(2000),
          content: "All 3 migrations applied. Running verification queries... OK.",
        },
      },
      {
        delayMs: 3200,
        event: { eventType: "status", timestamp: ts(2700), content: "completed" },
      },
    ],
  },

  // ── Scenario C — Test Writer (error/failed) ───────────
  {
    label: "Test Writer",
    pauseForInput: false,
    steps: [
      {
        delayMs: 0,
        event: { eventType: "status", timestamp: ts(0), content: "running" },
      },
      {
        delayMs: 700,
        event: {
          eventType: "output",
          timestamp: ts(700),
          content: "Generating test scaffolding for src/services/billing.ts...",
        },
      },
      {
        delayMs: 1800,
        event: {
          eventType: "output",
          timestamp: ts(1800),
          content: "Writing test cases:\n  - should calculate monthly total\n  - should apply discount codes\n  - should handle currency conversion\n  - should reject expired cards",
        },
      },
      {
        delayMs: 2800,
        event: {
          eventType: "output",
          timestamp: ts(2800),
          content: "Error: Cannot resolve import 'src/services/stripe-client.ts' — module not found.\nThe billing service depends on a Stripe client that doesn't exist in this environment.",
        },
      },
      {
        delayMs: 3500,
        event: { eventType: "status", timestamp: ts(3500), content: "failed" },
      },
    ],
  },
];
