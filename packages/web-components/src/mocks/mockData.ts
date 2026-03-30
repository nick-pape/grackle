/**
 * Static mock data for visual testing (`?mock` mode).
 *
 * Provides realistic sample entities that exercise every UI state:
 * multiple environments, sessions in various statuses, workspaces with
 * tasks at different lifecycle stages, and findings across all categories.
 */

import type {
  Environment,
  Session,
  SessionEvent,
  Workspace,
  TaskData,
  FindingData,
  TokenInfo,
  PersonaData,
} from "../hooks/types.js";
export { MOCK_KNOWLEDGE_NODES, MOCK_KNOWLEDGE_LINKS, MOCK_KNOWLEDGE_DETAILS } from "./mockKnowledgeData.js";

// ─── Environments ───────────────────────────────────

/** Sample environments covering different adapter types and statuses. */
export const MOCK_ENVIRONMENTS: Environment[] = [
  {
    id: "env-local-01",
    displayName: "Local Dev",
    adapterType: "local",
    adapterConfig: "{}",
    status: "connected",
    bootstrapped: true,
  },
  {
    id: "env-docker-01",
    displayName: "Docker Sandbox",
    adapterType: "docker",
    adapterConfig: '{"image":"node:20"}',
    status: "connected",
    bootstrapped: true,
  },
  {
    id: "env-cs-01",
    displayName: "GitHub Codespace",
    adapterType: "codespace",
    adapterConfig: '{"codespaceName":"my-codespace"}',
    status: "connected",
    bootstrapped: true,
  },
  {
    id: "env-remote-01",
    displayName: "Staging (SSH)",
    adapterType: "ssh",
    adapterConfig: '{"host":"192.168.1.10","user":"deploy","sshPort":22}',
    status: "disconnected",
    bootstrapped: false,
  },
];

// ─── Sessions ───────────────────────────────────────

/** Sample sessions spanning active, completed, and failed states. */
export const MOCK_SESSIONS: Session[] = [
  {
    id: "sess-001-prev",
    environmentId: "env-local-01",
    runtime: "claude-code",
    status: "stopped",
    endReason: "interrupted",
    prompt: "Implement auth middleware",
    startedAt: "2026-02-26T14:00:00Z",
    endedAt: "2026-02-26T15:12:00Z",
    error: "Context window exceeded before completing implementation",
    inputTokens: 84_200,
    outputTokens: 12_750,
    costUsd: 0.41,
  },
  {
    id: "sess-001",
    environmentId: "env-local-01",
    runtime: "claude-code",
    status: "running",
    prompt: "Refactor the authentication middleware to use JWT tokens",
    startedAt: "2026-02-27T08:15:00Z",
    inputTokens: 42_600,
    outputTokens: 8_100,
    costUsd: 0.22,
  },
  {
    id: "sess-002",
    environmentId: "env-docker-01",
    runtime: "copilot",
    status: "stopped",
    endReason: "completed",
    prompt: "Write unit tests for the user registration endpoint",
    startedAt: "2026-02-27T07:30:00Z",
    endedAt: "2026-02-27T07:33:00Z",
    inputTokens: 31_400,
    outputTokens: 9_800,
    costUsd: 0.18,
  },
  {
    id: "sess-003",
    environmentId: "env-local-01",
    runtime: "claude-code",
    status: "stopped",
    endReason: "interrupted",
    prompt: "Migrate database schema to add audit_log table",
    startedAt: "2026-02-26T22:45:00Z",
    endedAt: "2026-02-26T23:10:00Z",
    inputTokens: 56_300,
    outputTokens: 14_200,
    costUsd: 0.31,
  },
  {
    id: "sess-004",
    environmentId: "env-docker-01",
    runtime: "codex",
    status: "running",
    prompt: "Implement rate limiting for the public API",
    startedAt: "2026-02-27T09:00:00Z",
    inputTokens: 18_900,
    outputTokens: 4_500,
    costUsd: 0.10,
  },
  {
    id: "sess-005",
    environmentId: "env-cs-01",
    runtime: "claude-code",
    status: "suspended",
    prompt: "Refactor database connection pooling for multi-tenant isolation",
    startedAt: "2026-02-27T06:00:00Z",
    inputTokens: 67_800,
    outputTokens: 19_300,
    costUsd: 0.38,
  },
];

// ─── Session Events ─────────────────────────────────

/**
 * Rich event streams for all sessions. Each session has realistic agent
 * activity: system prompts, markdown text, tool calls with results, usage
 * badges, user input, and status transitions.
 */
export const MOCK_EVENTS: SessionEvent[] = [
  // ── sess-001-prev: failed JWT attempt (interrupted by context window) ──

  {
    sessionId: "sess-001-prev",
    eventType: "status",
    timestamp: "2026-02-26T14:00:01Z",
    content: "running",
  },
  {
    sessionId: "sess-001-prev",
    eventType: "system",
    timestamp: "2026-02-26T14:00:02Z",
    content: "You are a senior backend engineer. Focus on security best practices and thorough testing.\nProject: acme/alpha — Node.js + Express REST API\nTask: Implement auth middleware using JWT tokens",
    raw: JSON.stringify({ systemContext: true }),
  },
  {
    sessionId: "sess-001-prev",
    eventType: "text",
    timestamp: "2026-02-26T14:00:05Z",
    content: "I'll start by reading the current authentication middleware to understand what needs to change.",
  },
  {
    sessionId: "sess-001-prev",
    eventType: "tool_use",
    timestamp: "2026-02-26T14:00:06Z",
    content: JSON.stringify({ tool: "Read", args: { file_path: "src/middleware/auth.ts" } }),
    raw: JSON.stringify({ id: "tu-prev-001", type: "tool_use" }),
  },
  {
    sessionId: "sess-001-prev",
    eventType: "tool_result",
    timestamp: "2026-02-26T14:00:07Z",
    content: 'import session from "express-session";\nimport type { Request, Response, NextFunction } from "express";\n\nexport function requireAuth(req: Request, res: Response, next: NextFunction): void {\n  if (!req.session?.userId) {\n    res.status(401).json({ error: "Not authenticated" });\n    return;\n  }\n  next();\n}',
    raw: JSON.stringify({ tool_use_id: "tu-prev-001" }),
  },
  {
    sessionId: "sess-001-prev",
    eventType: "text",
    timestamp: "2026-02-26T14:00:10Z",
    content: "The current auth uses express-session with server-side session storage. Let me find all files that depend on this pattern.",
  },
  {
    sessionId: "sess-001-prev",
    eventType: "tool_use",
    timestamp: "2026-02-26T14:00:11Z",
    content: JSON.stringify({ tool: "Grep", args: { pattern: "req\\.session", path: "src/" } }),
    raw: JSON.stringify({ id: "tu-prev-002", type: "tool_use" }),
  },
  {
    sessionId: "sess-001-prev",
    eventType: "tool_result",
    timestamp: "2026-02-26T14:00:12Z",
    content: "src/middleware/auth.ts:4:  if (!req.session?.userId) {\nsrc/routes/login.ts:18:    req.session.userId = user.id;\nsrc/routes/login.ts:19:    req.session.role = user.role;\nsrc/routes/protected.ts:7:  const userId = req.session.userId;",
    raw: JSON.stringify({ tool_use_id: "tu-prev-002" }),
  },
  {
    sessionId: "sess-001-prev",
    eventType: "usage",
    timestamp: "2026-02-26T14:30:00Z",
    content: JSON.stringify({ input_tokens: 42100, output_tokens: 6350, cost_usd: 0.21 }),
  },
  {
    sessionId: "sess-001-prev",
    eventType: "text",
    timestamp: "2026-02-26T14:30:02Z",
    content: "Found 3 files using session-based auth. Now let me read the login route and the protected route to understand the full flow before making changes.",
  },
  {
    sessionId: "sess-001-prev",
    eventType: "tool_use",
    timestamp: "2026-02-26T14:30:03Z",
    content: JSON.stringify({ tool: "Read", args: { file_path: "src/routes/login.ts" } }),
    raw: JSON.stringify({ id: "tu-prev-003", type: "tool_use" }),
  },
  {
    sessionId: "sess-001-prev",
    eventType: "tool_result",
    timestamp: "2026-02-26T14:30:04Z",
    content: 'import { Router } from "express";\nimport bcrypt from "bcrypt";\nimport { db } from "../db.js";\n\nconst router = Router();\n\nrouter.post("/login", async (req, res) => {\n  const { email, password } = req.body;\n  const user = await db.users.findByEmail(email);\n  if (!user || !await bcrypt.compare(password, user.passwordHash)) {\n    return res.status(401).json({ error: "Invalid credentials" });\n  }\n  req.session.userId = user.id;\n  req.session.role = user.role;\n  res.json({ ok: true });\n});\n\nexport default router;',
    raw: JSON.stringify({ tool_use_id: "tu-prev-003" }),
  },
  {
    sessionId: "sess-001-prev",
    eventType: "error",
    timestamp: "2026-02-26T15:12:00Z",
    content: "Context window exceeded before completing implementation",
  },
  {
    sessionId: "sess-001-prev",
    eventType: "status",
    timestamp: "2026-02-26T15:12:01Z",
    content: "interrupted",
  },

  // ── sess-001: active JWT refactor (currently running) ──

  {
    sessionId: "sess-001",
    eventType: "status",
    timestamp: "2026-02-27T08:15:01Z",
    content: "running",
  },
  {
    sessionId: "sess-001",
    eventType: "system",
    timestamp: "2026-02-27T08:15:02Z",
    content: "You are a senior backend engineer. Focus on security best practices and thorough testing.\nProject: acme/alpha — Node.js + Express REST API\nTask: Implement auth middleware using JWT tokens\n\nNote: A previous session attempted this task but was interrupted. Pick up where it left off.",
    raw: JSON.stringify({ systemContext: true }),
  },
  {
    sessionId: "sess-001",
    eventType: "text",
    timestamp: "2026-02-27T08:15:04Z",
    content: "I'll pick up the JWT auth migration. The previous session identified 3 files that need updating. Let me verify the current state and start implementing.",
  },
  {
    sessionId: "sess-001",
    eventType: "tool_use",
    timestamp: "2026-02-27T08:15:04.5Z",
    content: JSON.stringify({
      tool: "TodoWrite",
      args: {
        todos: [
          { content: "Install jsonwebtoken package", activeForm: "Installing jsonwebtoken", status: "pending" },
          { content: "Rewrite auth middleware for JWT", activeForm: "Rewriting auth middleware", status: "pending" },
          { content: "Update login route to issue tokens", activeForm: "Updating login route", status: "pending" },
          { content: "Update protected routes", activeForm: "Updating protected routes", status: "pending" },
          { content: "Fix and update tests", activeForm: "Fixing tests", status: "pending" },
          { content: "Run full test suite", activeForm: "Running tests", status: "pending" },
        ],
      },
    }),
  },
  {
    sessionId: "sess-001",
    eventType: "tool_use",
    timestamp: "2026-02-27T08:15:05Z",
    content: JSON.stringify({ tool: "Grep", args: { pattern: "express-session|req\\.session", path: "src/", output_mode: "files_with_matches" } }),
    raw: JSON.stringify({ id: "tu-001-01", type: "tool_use" }),
  },
  {
    sessionId: "sess-001",
    eventType: "tool_result",
    timestamp: "2026-02-27T08:15:06Z",
    content: "src/middleware/auth.ts\nsrc/routes/login.ts\nsrc/routes/protected.ts",
    raw: JSON.stringify({ tool_use_id: "tu-001-01" }),
  },
  {
    sessionId: "sess-001",
    eventType: "text",
    timestamp: "2026-02-27T08:15:08Z",
    content: "Good, same 3 files. Let me install the JWT library first, then rewrite the middleware.",
  },
  {
    sessionId: "sess-001",
    eventType: "tool_use",
    timestamp: "2026-02-27T08:15:09Z",
    content: JSON.stringify({ tool: "Bash", args: { command: "npm install jsonwebtoken && npm install -D @types/jsonwebtoken" } }),
    raw: JSON.stringify({ id: "tu-001-02", type: "tool_use" }),
  },
  {
    sessionId: "sess-001",
    eventType: "tool_result",
    timestamp: "2026-02-27T08:15:11Z",
    content: "added 12 packages in 3.2s\n\nadded 1 package in 0.8s",
    raw: JSON.stringify({ tool_use_id: "tu-001-02" }),
  },
  {
    sessionId: "sess-001",
    eventType: "tool_use",
    timestamp: "2026-02-27T08:15:11.5Z",
    content: JSON.stringify({
      tool: "TodoWrite",
      args: {
        todos: [
          { content: "Install jsonwebtoken package", activeForm: "Installing jsonwebtoken", status: "completed" },
          { content: "Rewrite auth middleware for JWT", activeForm: "Rewriting auth middleware", status: "in_progress" },
          { content: "Update login route to issue tokens", activeForm: "Updating login route", status: "pending" },
          { content: "Update protected routes", activeForm: "Updating protected routes", status: "pending" },
          { content: "Fix and update tests", activeForm: "Fixing tests", status: "pending" },
          { content: "Run full test suite", activeForm: "Running tests", status: "pending" },
        ],
      },
    }),
  },
  {
    sessionId: "sess-001",
    eventType: "text",
    timestamp: "2026-02-27T08:15:12Z",
    content: "Now I'll rewrite the auth middleware to use JWT verification instead of session checks.",
  },
  {
    sessionId: "sess-001",
    eventType: "tool_use",
    timestamp: "2026-02-27T08:15:13Z",
    content: JSON.stringify({
      tool: "Write",
      args: {
        file_path: "src/middleware/auth.ts",
        content: 'import jwt from "jsonwebtoken";\nimport type { Request, Response, NextFunction } from "express";\n\nconst JWT_SECRET = process.env.JWT_SECRET || "change-me";\n\nexport interface JwtPayload {\n  userId: string;\n  role: string;\n  iat: number;\n  exp: number;\n}\n\nexport function verifyToken(req: Request, res: Response, next: NextFunction): void {\n  const header = req.headers.authorization;\n  if (!header?.startsWith("Bearer ")) {\n    res.status(401).json({ error: "Missing or malformed token" });\n    return;\n  }\n  try {\n    const decoded = jwt.verify(header.slice(7), JWT_SECRET) as JwtPayload;\n    req.user = decoded;\n    next();\n  } catch (err) {\n    if (err instanceof jwt.TokenExpiredError) {\n      res.status(401).json({ error: "Token expired" });\n    } else {\n      res.status(403).json({ error: "Invalid token" });\n    }\n  }\n}\n',
      },
    }),
    raw: JSON.stringify({ id: "tu-001-03", type: "tool_use" }),
  },
  {
    sessionId: "sess-001",
    eventType: "tool_result",
    timestamp: "2026-02-27T08:15:14Z",
    content: "File written: src/middleware/auth.ts (32 lines)",
    raw: JSON.stringify({ tool_use_id: "tu-001-03" }),
  },
  {
    sessionId: "sess-001",
    eventType: "text",
    timestamp: "2026-02-27T08:15:16Z",
    content: "Now I need to update the login route to issue JWT tokens instead of setting session data.\n\nThe new login flow will:\n1. Validate credentials (unchanged)\n2. Generate a JWT with `userId` and `role` claims\n3. Return the token in the response body\n4. Include a refresh token for long-lived sessions",
  },
  {
    sessionId: "sess-001",
    eventType: "tool_use",
    timestamp: "2026-02-27T08:15:17Z",
    content: JSON.stringify({
      tool: "Write",
      args: {
        file_path: "src/routes/login.ts",
        content: 'import { Router } from "express";\nimport bcrypt from "bcrypt";\nimport jwt from "jsonwebtoken";\nimport crypto from "node:crypto";\nimport { db } from "../db.js";\n\nconst JWT_SECRET = process.env.JWT_SECRET || "change-me";\nconst ACCESS_TOKEN_EXPIRY = "24h";\nconst REFRESH_TOKEN_BYTES = 48;\n\nconst router = Router();\n\nrouter.post("/login", async (req, res) => {\n  const { email, password } = req.body;\n  const user = await db.users.findByEmail(email);\n  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {\n    return res.status(401).json({ error: "Invalid credentials" });\n  }\n\n  const accessToken = jwt.sign(\n    { userId: user.id, role: user.role },\n    JWT_SECRET,\n    { expiresIn: ACCESS_TOKEN_EXPIRY },\n  );\n\n  const refreshToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");\n  await db.refreshTokens.create({ userId: user.id, token: refreshToken });\n\n  res.json({ accessToken, refreshToken, expiresIn: ACCESS_TOKEN_EXPIRY });\n});\n\nexport default router;\n',
      },
    }),
    raw: JSON.stringify({ id: "tu-001-04", type: "tool_use" }),
  },
  {
    sessionId: "sess-001",
    eventType: "tool_result",
    timestamp: "2026-02-27T08:15:18Z",
    content: "File written: src/routes/login.ts (33 lines)",
    raw: JSON.stringify({ tool_use_id: "tu-001-04" }),
  },
  {
    sessionId: "sess-001",
    eventType: "text",
    timestamp: "2026-02-27T08:15:20Z",
    content: "Let me update the protected route to use the new `req.user` shape from the JWT payload.",
  },
  {
    sessionId: "sess-001",
    eventType: "tool_use",
    timestamp: "2026-02-27T08:15:21Z",
    content: JSON.stringify({
      tool: "Edit",
      args: {
        file_path: "src/routes/protected.ts",
        old_string: "const userId = req.session.userId;",
        new_string: "const { userId } = req.user as JwtPayload;",
      },
    }),
    raw: JSON.stringify({ id: "tu-001-05", type: "tool_use" }),
  },
  {
    sessionId: "sess-001",
    eventType: "tool_result",
    timestamp: "2026-02-27T08:15:22Z",
    content: "Updated src/routes/protected.ts",
    raw: JSON.stringify({ tool_use_id: "tu-001-05" }),
  },
  {
    sessionId: "sess-001",
    eventType: "text",
    timestamp: "2026-02-27T08:15:24Z",
    content: "Now let me run the existing tests to make sure nothing is broken, then I'll add new JWT-specific tests.",
  },
  {
    sessionId: "sess-001",
    eventType: "tool_use",
    timestamp: "2026-02-27T08:15:25Z",
    content: JSON.stringify({ tool: "Bash", args: { command: "npm test" } }),
    raw: JSON.stringify({ id: "tu-001-06", type: "tool_use" }),
  },
  {
    sessionId: "sess-001",
    eventType: "tool_result",
    timestamp: "2026-02-27T08:15:30Z",
    content: " PASS  src/routes/__tests__/login.test.ts\n PASS  src/routes/__tests__/protected.test.ts\n FAIL  src/middleware/__tests__/auth.test.ts\n  x should reject missing session (12ms)\n  x should allow valid session (8ms)\n\n  2 failed, 12 passed, 14 total\n\nTest Suites: 1 failed, 2 passed, 3 total",
    raw: JSON.stringify({ tool_use_id: "tu-001-06", is_error: true }),
  },
  {
    sessionId: "sess-001",
    eventType: "text",
    timestamp: "2026-02-27T08:15:32Z",
    content: "Two tests failed because they still test the old session-based auth. I need to rewrite those tests for JWT.\n\nLet me update the auth middleware tests:",
  },
  {
    sessionId: "sess-001",
    eventType: "tool_use",
    timestamp: "2026-02-27T08:15:33Z",
    content: JSON.stringify({
      tool: "Write",
      args: {
        file_path: "src/middleware/__tests__/auth.test.ts",
        content: 'import { describe, it, expect } from "vitest";\nimport jwt from "jsonwebtoken";\nimport { verifyToken } from "../auth.js";\nimport { createMockReqRes } from "../../test-utils/mock-express.js";\n\nconst SECRET = "test-secret";\nprocess.env.JWT_SECRET = SECRET;\n\ndescribe("verifyToken", () => {\n  it("should reject requests without Authorization header", () => {\n    const { req, res, next } = createMockReqRes();\n    verifyToken(req, res, next);\n    expect(res.status).toHaveBeenCalledWith(401);\n  });\n\n  it("should reject expired tokens", () => {\n    const token = jwt.sign({ userId: "u1", role: "user" }, SECRET, { expiresIn: "-1h" });\n    const { req, res, next } = createMockReqRes({ authorization: `Bearer ${token}` });\n    verifyToken(req, res, next);\n    expect(res.status).toHaveBeenCalledWith(401);\n  });\n\n  it("should accept valid tokens and attach user to request", () => {\n    const token = jwt.sign({ userId: "u1", role: "admin" }, SECRET, { expiresIn: "1h" });\n    const { req, res, next } = createMockReqRes({ authorization: `Bearer ${token}` });\n    verifyToken(req, res, next);\n    expect(next).toHaveBeenCalled();\n    expect(req.user).toMatchObject({ userId: "u1", role: "admin" });\n  });\n});\n',
      },
    }),
    raw: JSON.stringify({ id: "tu-001-07", type: "tool_use" }),
  },
  {
    sessionId: "sess-001",
    eventType: "tool_result",
    timestamp: "2026-02-27T08:15:34Z",
    content: "File written: src/middleware/__tests__/auth.test.ts (32 lines)",
    raw: JSON.stringify({ tool_use_id: "tu-001-07" }),
  },
  {
    sessionId: "sess-001",
    eventType: "tool_use",
    timestamp: "2026-02-27T08:15:35Z",
    content: JSON.stringify({ tool: "Bash", args: { command: "npm test" } }),
    raw: JSON.stringify({ id: "tu-001-08", type: "tool_use" }),
  },
  {
    sessionId: "sess-001",
    eventType: "tool_result",
    timestamp: "2026-02-27T08:15:40Z",
    content: " PASS  src/routes/__tests__/login.test.ts\n PASS  src/routes/__tests__/protected.test.ts\n PASS  src/middleware/__tests__/auth.test.ts\n\nTest Suites: 3 passed, 3 total\nTests:       14 passed, 14 total",
    raw: JSON.stringify({ tool_use_id: "tu-001-08" }),
  },
  {
    sessionId: "sess-001",
    eventType: "usage",
    timestamp: "2026-02-27T08:15:41Z",
    content: JSON.stringify({ input_tokens: 42600, output_tokens: 8100, cost_usd: 0.22 }),
  },
  {
    sessionId: "sess-001",
    eventType: "text",
    timestamp: "2026-02-27T08:15:42Z",
    content: "All 14 tests pass. Here's a summary of the changes:\n\n### Changes made\n\n| File | Action |\n|------|--------|\n| `src/middleware/auth.ts` | Rewrote to verify JWT Bearer tokens |\n| `src/routes/login.ts` | Now issues JWT access + refresh tokens |\n| `src/routes/protected.ts` | Updated to read `req.user` from JWT payload |\n| `src/middleware/__tests__/auth.test.ts` | Updated tests for JWT verification |\n\n### Key decisions\n- **Access token expiry**: 24 hours (configurable via `JWT_SECRET` env var)\n- **Refresh tokens**: 48-byte random hex, stored in DB\n- **Error handling**: Distinguishes expired tokens (401) from invalid tokens (403)",
  },

  // ── sess-002: completed unit test session ──

  {
    sessionId: "sess-002",
    eventType: "status",
    timestamp: "2026-02-27T07:30:01Z",
    content: "running",
  },
  {
    sessionId: "sess-002",
    eventType: "system",
    timestamp: "2026-02-27T07:30:02Z",
    content: "You are a QA engineer. Write comprehensive tests covering happy paths, edge cases, error scenarios, and security.\nProject: acme/alpha — Node.js + Express REST API\nTask: Write unit tests for the user registration endpoint",
    raw: JSON.stringify({ systemContext: true }),
  },
  {
    sessionId: "sess-002",
    eventType: "text",
    timestamp: "2026-02-27T07:30:04Z",
    content: "I'll write thorough tests for `POST /api/register`. Let me first read the registration endpoint to understand its behavior.",
  },
  {
    sessionId: "sess-002",
    eventType: "tool_use",
    timestamp: "2026-02-27T07:30:05Z",
    content: JSON.stringify({ tool: "Read", args: { file_path: "src/routes/register.ts" } }),
    raw: JSON.stringify({ id: "tu-002-01", type: "tool_use" }),
  },
  {
    sessionId: "sess-002",
    eventType: "tool_result",
    timestamp: "2026-02-27T07:30:06Z",
    content: 'import { Router } from "express";\nimport bcrypt from "bcrypt";\nimport { db } from "../db.js";\nimport { validateEmail, validatePassword } from "../utils/validators.js";\n\nconst SALT_ROUNDS = 12;\nconst router = Router();\n\nrouter.post("/register", async (req, res) => {\n  const { name, email, password } = req.body;\n\n  if (!name || !email || !password) {\n    return res.status(400).json({ error: "Missing required fields" });\n  }\n  if (!validateEmail(email)) {\n    return res.status(400).json({ error: "Invalid email format" });\n  }\n  if (!validatePassword(password)) {\n    return res.status(400).json({ error: "Password too weak" });\n  }\n\n  const existing = await db.users.findByEmail(email);\n  if (existing) {\n    return res.status(409).json({ error: "Email already registered" });\n  }\n\n  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);\n  const user = await db.users.create({ name, email, passwordHash });\n  res.status(201).json({ id: user.id, name: user.name, email: user.email });\n});\n\nexport default router;',
    raw: JSON.stringify({ tool_use_id: "tu-002-01" }),
  },
  {
    sessionId: "sess-002",
    eventType: "text",
    timestamp: "2026-02-27T07:30:10Z",
    content: "Good. The endpoint validates input, checks for duplicates, hashes the password, and creates the user. I'll write tests covering:\n\n1. **Happy path** - valid registration\n2. **Missing fields** - each required field missing\n3. **Invalid email** - malformed email format\n4. **Weak password** - password validation failure\n5. **Duplicate email** - conflict with existing user\n6. **SQL injection** - malicious email input\n7. **XSS payload** - HTML in the name field\n8. **Response shape** - correct status codes and body structure",
  },
  {
    sessionId: "sess-002",
    eventType: "tool_use",
    timestamp: "2026-02-27T07:30:12Z",
    content: JSON.stringify({
      tool: "Write",
      args: {
        file_path: "src/routes/__tests__/register.test.ts",
        content: "// [test content - 8 test cases as described above]",
      },
    }),
    raw: JSON.stringify({ id: "tu-002-02", type: "tool_use" }),
  },
  {
    sessionId: "sess-002",
    eventType: "tool_result",
    timestamp: "2026-02-27T07:30:13Z",
    content: "File written: src/routes/__tests__/register.test.ts (142 lines)",
    raw: JSON.stringify({ tool_use_id: "tu-002-02" }),
  },
  {
    sessionId: "sess-002",
    eventType: "tool_use",
    timestamp: "2026-02-27T07:31:00Z",
    content: JSON.stringify({ tool: "Bash", args: { command: "npm test -- --testPathPattern=register" } }),
    raw: JSON.stringify({ id: "tu-002-03", type: "tool_use" }),
  },
  {
    sessionId: "sess-002",
    eventType: "tool_result",
    timestamp: "2026-02-27T07:31:30Z",
    content: " PASS  src/routes/__tests__/register.test.ts\n  POST /api/register\n    \u2713 should register a valid user (28ms)\n    \u2713 should reject missing name (4ms)\n    \u2713 should reject missing email (3ms)\n    \u2713 should reject missing password (3ms)\n    \u2713 should reject invalid email format (5ms)\n    \u2713 should reject weak password (4ms)\n    \u2713 should reject duplicate email (12ms)\n    \u2713 should sanitize HTML in name field (6ms)\n\nTests: 8 passed, 8 total",
    raw: JSON.stringify({ tool_use_id: "tu-002-03" }),
  },
  {
    sessionId: "sess-002",
    eventType: "usage",
    timestamp: "2026-02-27T07:32:00Z",
    content: JSON.stringify({ input_tokens: 31400, output_tokens: 9800, cost_usd: 0.18 }),
  },
  {
    sessionId: "sess-002",
    eventType: "text",
    timestamp: "2026-02-27T07:32:30Z",
    content: "All 8 test cases pass. Created `src/routes/__tests__/register.test.ts` with comprehensive coverage for the registration endpoint including input validation, duplicate detection, and security edge cases.",
  },
  {
    sessionId: "sess-002",
    eventType: "status",
    timestamp: "2026-02-27T07:33:00Z",
    content: "completed",
  },

  // ── sess-003: database migration (interrupted) ──

  {
    sessionId: "sess-003",
    eventType: "status",
    timestamp: "2026-02-26T22:45:01Z",
    content: "running",
  },
  {
    sessionId: "sess-003",
    eventType: "system",
    timestamp: "2026-02-26T22:45:02Z",
    content: "You are a database engineer. Focus on safe migrations, zero-downtime deployments, and data integrity.\nProject: acme/alpha — Node.js + Express + PostgreSQL\nTask: Add audit_log table and migrate schema",
    raw: JSON.stringify({ systemContext: true }),
  },
  {
    sessionId: "sess-003",
    eventType: "text",
    timestamp: "2026-02-26T22:45:05Z",
    content: "I need to add an `audit_log` table for tracking all write operations. Let me review the current schema first.",
  },
  {
    sessionId: "sess-003",
    eventType: "tool_use",
    timestamp: "2026-02-26T22:45:06Z",
    content: JSON.stringify({ tool: "Read", args: { file_path: "migrations/001_initial.sql" } }),
    raw: JSON.stringify({ id: "tu-003-01", type: "tool_use" }),
  },
  {
    sessionId: "sess-003",
    eventType: "tool_result",
    timestamp: "2026-02-26T22:45:07Z",
    content: "CREATE TABLE users (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  name TEXT NOT NULL,\n  email TEXT UNIQUE NOT NULL,\n  password_hash TEXT NOT NULL,\n  role TEXT DEFAULT 'user',\n  created_at TIMESTAMPTZ DEFAULT now(),\n  updated_at TIMESTAMPTZ DEFAULT now()\n);\n\nCREATE TABLE sessions (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  user_id UUID REFERENCES users(id),\n  expires_at TIMESTAMPTZ NOT NULL,\n  created_at TIMESTAMPTZ DEFAULT now()\n);",
    raw: JSON.stringify({ tool_use_id: "tu-003-01" }),
  },
  {
    sessionId: "sess-003",
    eventType: "text",
    timestamp: "2026-02-26T22:45:12Z",
    content: "I see the schema. I'll create a migration that:\n1. Adds a `last_login_at` column to `users`\n2. Adds an index on `sessions.expires_at` for efficient cleanup queries\n3. Creates the `audit_log` table\n\nLet me write the migration file:",
  },
  {
    sessionId: "sess-003",
    eventType: "tool_use",
    timestamp: "2026-02-26T22:45:14Z",
    content: JSON.stringify({
      tool: "Write",
      args: {
        file_path: "migrations/002_audit_log.sql",
        content: "-- Migration: 002_audit_log\n-- Add audit logging and user activity tracking\n\nBEGIN;\n\n-- 1. Add last_login_at to users\nALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;\n\n-- 2. Index for session cleanup queries\nCREATE INDEX CONCURRENTLY idx_sessions_expires_at ON sessions (expires_at);\n\n-- 3. Audit log table\nCREATE TABLE audit_log (\n  id BIGSERIAL PRIMARY KEY,\n  user_id UUID REFERENCES users(id),\n  action TEXT NOT NULL,\n  entity_type TEXT NOT NULL,\n  entity_id TEXT NOT NULL,\n  old_value JSONB,\n  new_value JSONB,\n  ip_address INET,\n  created_at TIMESTAMPTZ DEFAULT now()\n);\n\nCREATE INDEX idx_audit_log_user ON audit_log (user_id);\nCREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id);\nCREATE INDEX idx_audit_log_created ON audit_log (created_at);\n\nCOMMIT;\n",
      },
    }),
    raw: JSON.stringify({ id: "tu-003-02", type: "tool_use" }),
  },
  {
    sessionId: "sess-003",
    eventType: "tool_result",
    timestamp: "2026-02-26T22:45:15Z",
    content: "File written: migrations/002_audit_log.sql (29 lines)",
    raw: JSON.stringify({ tool_use_id: "tu-003-02" }),
  },
  {
    sessionId: "sess-003",
    eventType: "text",
    timestamp: "2026-02-26T22:46:00Z",
    content: "Now I need to implement the audit middleware that logs write operations. This will intercept POST, PUT, PATCH, and DELETE requests.",
  },
  {
    sessionId: "sess-003",
    eventType: "tool_use",
    timestamp: "2026-02-26T22:46:02Z",
    content: JSON.stringify({ tool: "Bash", args: { command: "npm run migrate -- --dry-run" } }),
    raw: JSON.stringify({ id: "tu-003-03", type: "tool_use" }),
  },
  {
    sessionId: "sess-003",
    eventType: "tool_result",
    timestamp: "2026-02-26T22:46:10Z",
    content: "Dry run: would apply 002_audit_log.sql\n  - ALTER TABLE users ADD COLUMN last_login_at\n  - CREATE INDEX CONCURRENTLY idx_sessions_expires_at\n  - CREATE TABLE audit_log\n  - 3 indexes on audit_log\n\nWARNING: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.\nPlease split this into a separate migration step.",
    raw: JSON.stringify({ tool_use_id: "tu-003-03", is_error: true }),
  },
  {
    sessionId: "sess-003",
    eventType: "text",
    timestamp: "2026-02-26T22:46:15Z",
    content: "Good catch from the dry run! `CREATE INDEX CONCURRENTLY` can't run inside a transaction. I need to split the migration into two files: one for the transactional DDL and another for the concurrent index creation.",
  },
  {
    sessionId: "sess-003",
    eventType: "usage",
    timestamp: "2026-02-26T23:00:00Z",
    content: JSON.stringify({ input_tokens: 56300, output_tokens: 14200, cost_usd: 0.31 }),
  },
  {
    sessionId: "sess-003",
    eventType: "status",
    timestamp: "2026-02-26T23:10:00Z",
    content: "interrupted",
  },

  // ── sess-004: rate limiting implementation (currently running) ──

  {
    sessionId: "sess-004",
    eventType: "status",
    timestamp: "2026-02-27T09:00:01Z",
    content: "running",
  },
  {
    sessionId: "sess-004",
    eventType: "system",
    timestamp: "2026-02-27T09:00:02Z",
    content: "You are a backend engineer specializing in API infrastructure.\nProject: acme/data-pipeline — ETL pipelines for analytics\nTask: Implement rate limiting for the public API using a token-bucket algorithm",
    raw: JSON.stringify({ systemContext: true }),
  },
  {
    sessionId: "sess-004",
    eventType: "text",
    timestamp: "2026-02-27T09:00:05Z",
    content: "I'll implement rate limiting using a token-bucket algorithm. Let me first survey the existing API infrastructure to find the right integration point.",
  },
  {
    sessionId: "sess-004",
    eventType: "tool_use",
    timestamp: "2026-02-27T09:00:05.5Z",
    content: JSON.stringify({
      tool: "TodoWrite",
      args: {
        todos: [
          { content: "Survey middleware structure", activeForm: "Surveying middleware", status: "in_progress" },
          { content: "Implement token-bucket algorithm", activeForm: "Implementing token bucket", status: "pending" },
          { content: "Add rate limit middleware to app", activeForm: "Adding middleware", status: "pending" },
          { content: "Write tests for rate limiting", activeForm: "Writing tests", status: "pending" },
          { content: "Add Redis adapter for multi-instance", activeForm: "Adding Redis adapter", status: "pending" },
        ],
      },
    }),
  },
  {
    sessionId: "sess-004",
    eventType: "tool_use",
    timestamp: "2026-02-27T09:00:06Z",
    content: JSON.stringify({ tool: "Glob", args: { pattern: "src/middleware/**/*.ts" } }),
    raw: JSON.stringify({ id: "tu-004-01", type: "tool_use" }),
  },
  {
    sessionId: "sess-004",
    eventType: "tool_result",
    timestamp: "2026-02-27T09:00:07Z",
    content: "src/middleware/cors.ts\nsrc/middleware/error-handler.ts\nsrc/middleware/logger.ts\nsrc/middleware/request-id.ts",
    raw: JSON.stringify({ tool_use_id: "tu-004-01" }),
  },
  {
    sessionId: "sess-004",
    eventType: "tool_use",
    timestamp: "2026-02-27T09:00:09Z",
    content: JSON.stringify({
      tool: "TodoWrite",
      args: {
        todos: [
          { content: "Survey middleware structure", activeForm: "Surveying middleware", status: "completed" },
          { content: "Implement token-bucket algorithm", activeForm: "Implementing token bucket", status: "in_progress" },
          { content: "Add rate limit middleware to app", activeForm: "Adding middleware", status: "pending" },
          { content: "Write tests for rate limiting", activeForm: "Writing tests", status: "pending" },
          { content: "Add Redis adapter for multi-instance", activeForm: "Adding Redis adapter", status: "pending" },
        ],
      },
    }),
  },
  {
    sessionId: "sess-004",
    eventType: "text",
    timestamp: "2026-02-27T09:00:10Z",
    content: "Good middleware structure already in place. I'll add a `rate-limiter.ts` module that:\n\n- Uses an **in-memory token bucket** per client IP\n- Supports configurable rate (requests/second) and burst size\n- Returns `429 Too Many Requests` with `Retry-After` header\n- Has a Redis adapter option for multi-instance deployments\n\nLet me implement it:",
  },
  {
    sessionId: "sess-004",
    eventType: "tool_use",
    timestamp: "2026-02-27T09:00:12Z",
    content: JSON.stringify({
      tool: "Write",
      args: {
        file_path: "src/middleware/rate-limiter.ts",
        content: "// Token bucket rate limiter implementation",
      },
    }),
    raw: JSON.stringify({ id: "tu-004-02", type: "tool_use" }),
  },
  {
    sessionId: "sess-004",
    eventType: "tool_result",
    timestamp: "2026-02-27T09:00:13Z",
    content: "File written: src/middleware/rate-limiter.ts (87 lines)",
    raw: JSON.stringify({ tool_use_id: "tu-004-02" }),
  },
  {
    sessionId: "sess-004",
    eventType: "text",
    timestamp: "2026-02-27T09:00:18Z",
    content: "Now I need to wire the rate limiter into the Express middleware stack. It should go after the request-ID middleware but before route handlers.",
  },

  // ── sess-005: suspended session (DB pooling refactor) ──

  {
    sessionId: "sess-005",
    eventType: "status",
    timestamp: "2026-02-27T06:00:01Z",
    content: "running",
  },
  {
    sessionId: "sess-005",
    eventType: "system",
    timestamp: "2026-02-27T06:00:02Z",
    content: "You are a database specialist. Focus on connection management, performance, and multi-tenant isolation.\nProject: acme/alpha — Node.js + Express + PostgreSQL\nTask: Refactor database connection pooling for multi-tenant isolation",
    raw: JSON.stringify({ systemContext: true }),
  },
  {
    sessionId: "sess-005",
    eventType: "text",
    timestamp: "2026-02-27T06:00:05Z",
    content: "I'll refactor the DB layer to support per-tenant connection pools. This is needed because the current single-pool design means one slow tenant can exhaust connections for everyone.",
  },
  {
    sessionId: "sess-005",
    eventType: "tool_use",
    timestamp: "2026-02-27T06:00:06Z",
    content: JSON.stringify({ tool: "Read", args: { file_path: "src/db/pool.ts" } }),
    raw: JSON.stringify({ id: "tu-005-01", type: "tool_use" }),
  },
  {
    sessionId: "sess-005",
    eventType: "tool_result",
    timestamp: "2026-02-27T06:00:07Z",
    content: 'import pg from "pg";\n\nconst pool = new pg.Pool({\n  connectionString: process.env.DATABASE_URL,\n  max: 20,\n  idleTimeoutMillis: 30000,\n});\n\nexport { pool };',
    raw: JSON.stringify({ tool_use_id: "tu-005-01" }),
  },
  {
    sessionId: "sess-005",
    eventType: "text",
    timestamp: "2026-02-27T06:00:12Z",
    content: "The current pool is a single shared instance with `max: 20`. For multi-tenant isolation, I need:\n\n1. **A `PoolManager` class** that creates and caches per-tenant pools\n2. **Configurable limits** per tenant (max connections, idle timeout)\n3. **Health checks** with automatic pool eviction for unhealthy connections\n4. **Graceful shutdown** that drains all pools",
  },
  {
    sessionId: "sess-005",
    eventType: "tool_use",
    timestamp: "2026-02-27T06:00:14Z",
    content: JSON.stringify({ tool: "Grep", args: { pattern: "import.*pool|from.*pool", path: "src/", output_mode: "content" } }),
    raw: JSON.stringify({ id: "tu-005-02", type: "tool_use" }),
  },
  {
    sessionId: "sess-005",
    eventType: "tool_result",
    timestamp: "2026-02-27T06:00:15Z",
    content: 'src/db/index.ts:1:import { pool } from "./pool.js";\nsrc/routes/users.ts:2:import { pool } from "../db/pool.js";\nsrc/routes/register.ts:3:import { pool } from "../db/pool.js";\nsrc/routes/admin.ts:4:import { pool } from "../db/pool.js";\nsrc/services/billing.ts:2:import { pool } from "../db/pool.js";\nsrc/services/analytics.ts:1:import { pool } from "../db/pool.js";',
    raw: JSON.stringify({ tool_use_id: "tu-005-02" }),
  },
  {
    sessionId: "sess-005",
    eventType: "text",
    timestamp: "2026-02-27T06:00:20Z",
    content: "Six files import the pool directly. I'll need to:\n1. Create a new `PoolManager` abstraction\n2. Update all consumers to use `getPool(tenantId)` instead of the global pool\n3. Add middleware to extract tenant ID from the request\n\nThis is a significant refactor. Let me start with the PoolManager class.",
  },
  {
    sessionId: "sess-005",
    eventType: "usage",
    timestamp: "2026-02-27T06:30:00Z",
    content: JSON.stringify({ input_tokens: 67800, output_tokens: 19300, cost_usd: 0.38 }),
  },
  {
    sessionId: "sess-005",
    eventType: "status",
    timestamp: "2026-02-27T06:30:01Z",
    content: "suspended",
  },
];

// ─── Workspaces ─────────────────────────────────────

/** Sample workspaces at different lifecycle stages. */
export const MOCK_WORKSPACES: Workspace[] = [
  {
    id: "proj-alpha",
    name: "Workspace Alpha",
    description: "Core platform API and authentication services",
    repoUrl: "https://github.com/acme/alpha",
    environmentId: "env-local-01",
    linkedEnvironmentIds: ["env-docker-01"],
    status: "active",
    workingDirectory: "",
    useWorktrees: true,
    defaultPersonaId: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: "2026-01-15T10:00:00Z",
  },
  {
    id: "proj-beta",
    name: "Data Pipeline",
    description: "ETL pipelines for analytics and reporting",
    repoUrl: "https://github.com/acme/data-pipeline",
    environmentId: "env-docker-01",
    linkedEnvironmentIds: [],
    status: "active",
    workingDirectory: "",
    useWorktrees: true,
    defaultPersonaId: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
    createdAt: "2026-02-01T14:30:00Z",
    updatedAt: "2026-02-01T14:30:00Z",
  },
  {
    id: "proj-gamma",
    name: "Mobile App",
    description: "React Native cross-platform mobile application",
    repoUrl: "",
    environmentId: "env-local-01",
    linkedEnvironmentIds: [],
    status: "archived",
    workingDirectory: "",
    useWorktrees: true,
    defaultPersonaId: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
    createdAt: "2025-11-20T09:00:00Z",
    updatedAt: "2025-11-20T09:00:00Z",
  },
];

// ─── Tasks ──────────────────────────────────────────

/** Sample tasks demonstrating every status in the lifecycle, including parent/child hierarchy. */
export const MOCK_TASKS: TaskData[] = [
  // ── Root tasks for proj-alpha ──────────────────────
  {
    id: "task-001",
    workspaceId: "proj-alpha",
    title: "Implement JWT authentication",
    description: "Replace session-based auth with JWT tokens across all protected routes",
    status: "working",
    branch: "feat/jwt-auth",
    latestSessionId: "sess-001",
    dependsOn: [],
    reviewNotes: undefined,
    sortOrder: 1,
    createdAt: "2026-02-25T10:00:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: ["task-001a", "task-001b", "task-001c"],
    canDecompose: true,
    defaultPersonaId: "",
    workpad: JSON.stringify({
      status: "in_progress",
      summary: "Design and implement JWT-based authentication with access/refresh tokens, replacing session-based auth.",
      extra: {
        approach: "Replace express-session with JWT Bearer tokens. Access tokens expire in 24h, refresh tokens stored in DB.",
        files_changed: ["src/middleware/auth.ts", "src/routes/login.ts", "src/routes/protected.ts"],
        decisions: [
          "Chose jsonwebtoken over jose for consistency with existing codebase",
          "24h access token expiry — long enough for dev sessions, short enough for security",
          "Refresh tokens are 48-byte random hex stored in DB with user association",
        ],
        blockers: "Need to verify token rotation strategy with security team before merging",
      },
    }),
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  // ── Children of task-001 ───────────────────────────
  {
    id: "task-001a",
    workspaceId: "proj-alpha",
    title: "Design token schema",
    description: "Define JWT payload structure, expiry, and refresh token strategy",
    status: "complete",
    branch: "feat/jwt-auth/design-token-schema",
    latestSessionId: "",
    dependsOn: [],
    reviewNotes: undefined,
    sortOrder: 1,
    createdAt: "2026-02-25T10:10:00Z",
    parentTaskId: "task-001",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  {
    id: "task-001b",
    workspaceId: "proj-alpha",
    title: "Implement auth middleware",
    description: "Build Express middleware that verifies JWT Bearer tokens",
    status: "working",
    branch: "feat/jwt-auth/implement-auth-middleware",
    latestSessionId: "sess-001",
    dependsOn: [],
    reviewNotes: undefined,
    sortOrder: 2,
    createdAt: "2026-02-25T10:15:00Z",
    parentTaskId: "task-001",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  {
    id: "task-001c",
    workspaceId: "proj-alpha",
    title: "Write auth integration tests",
    description: "End-to-end tests for login flow, token refresh, and protected route access",
    status: "not_started",
    branch: "",
    latestSessionId: "",
    dependsOn: ["task-001b"],
    reviewNotes: undefined,
    sortOrder: 3,
    createdAt: "2026-02-25T10:20:00Z",
    parentTaskId: "task-001",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  // ── Remaining root tasks for proj-alpha ────────────
  {
    id: "task-002",
    workspaceId: "proj-alpha",
    title: "Add rate limiting",
    description: "Implement token-bucket rate limiting for public API endpoints",
    status: "not_started",
    branch: "",
    latestSessionId: "",
    dependsOn: ["task-001"],
    reviewNotes: undefined,
    sortOrder: 2,
    createdAt: "2026-02-25T10:05:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  {
    id: "task-003",
    workspaceId: "proj-alpha",
    title: "Set up OpenAPI documentation",
    description: "Generate Swagger docs from route decorators and serve at /api/docs",
    status: "paused",
    branch: "feat/openapi-docs",
    latestSessionId: "sess-002",
    dependsOn: [],
    reviewNotes: undefined,
    sortOrder: 3,
    createdAt: "2026-02-24T16:00:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  {
    id: "task-004",
    workspaceId: "proj-alpha",
    title: "Database connection pooling",
    description: "Switch from single connection to a connection pool with health checks",
    status: "complete",
    branch: "feat/db-pool",
    latestSessionId: "",
    dependsOn: [],
    reviewNotes: undefined,
    sortOrder: 4,
    createdAt: "2026-02-23T11:00:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  {
    id: "task-005",
    workspaceId: "proj-alpha",
    title: "Fix N+1 query in user list",
    description: "Use a JOIN instead of per-row lookups in GET /api/users",
    status: "not_started",
    branch: "fix/user-list-n1",
    latestSessionId: "",
    dependsOn: [],
    reviewNotes: undefined,
    sortOrder: 5,
    createdAt: "2026-02-22T09:30:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  // ── Tasks for proj-beta ────────────────────────────
  {
    id: "task-006",
    workspaceId: "proj-beta",
    title: "Add Parquet export support",
    description: "Allow pipeline outputs to be written as Parquet files for Spark consumption",
    status: "working",
    branch: "feat/parquet-export",
    latestSessionId: "",
    dependsOn: [],
    reviewNotes: undefined,
    sortOrder: 1,
    createdAt: "2026-02-26T08:00:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: ["task-006a", "task-006b", "task-006c", "task-006d"],
    canDecompose: true,
    defaultPersonaId: "",
    workpad: JSON.stringify({
      status: "in_progress",
      summary: "Plan for adding Parquet export support, including compression options and performance benchmarks.",
      extra: {
        approach: "Use apache-arrow npm package for Parquet write support. Map internal column types to Arrow type system.",
        compression: { supported: ["snappy", "zstd", "gzip"], default: "snappy" },
        benchmarks: { "1M rows snappy": "2.3s", "1M rows zstd": "3.1s", "1M rows gzip": "4.8s" },
      },
    }),
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  // ── Children of task-006 ───────────────────────────
  {
    id: "task-006a",
    workspaceId: "proj-beta",
    title: "Define Parquet schema mapping",
    description: "Map internal column types to Arrow/Parquet type system",
    status: "complete",
    branch: "feat/parquet-export/define-parquet-schema-mapping",
    latestSessionId: "",
    dependsOn: [],
    reviewNotes: undefined,
    sortOrder: 1,
    createdAt: "2026-02-26T08:05:00Z",
    parentTaskId: "task-006",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  {
    id: "task-006b",
    workspaceId: "proj-beta",
    title: "Implement row-group writer",
    description: "Write buffered row groups with configurable batch size",
    status: "complete",
    branch: "feat/parquet-export/implement-row-group-writer",
    latestSessionId: "",
    dependsOn: ["task-006a"],
    reviewNotes: undefined,
    sortOrder: 2,
    createdAt: "2026-02-26T08:10:00Z",
    parentTaskId: "task-006",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  {
    id: "task-006c",
    workspaceId: "proj-beta",
    title: "Add compression options",
    description: "Support Snappy, ZSTD, and GZIP compression for Parquet output",
    status: "working",
    branch: "feat/parquet-export/add-compression-options",
    latestSessionId: "sess-004",
    dependsOn: ["task-006b"],
    reviewNotes: undefined,
    sortOrder: 3,
    createdAt: "2026-02-26T08:15:00Z",
    parentTaskId: "task-006",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  {
    id: "task-006d",
    workspaceId: "proj-beta",
    title: "Write Parquet integration tests",
    description: "Round-trip tests: write Parquet, read back with pyarrow, verify data integrity",
    status: "not_started",
    branch: "",
    latestSessionId: "",
    dependsOn: ["task-006c"],
    reviewNotes: undefined,
    sortOrder: 4,
    createdAt: "2026-02-26T08:20:00Z",
    parentTaskId: "task-006",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  // ── Remaining root tasks for proj-beta ─────────────
  {
    id: "task-007",
    workspaceId: "proj-beta",
    title: "Implement incremental loads",
    description: "Track watermarks so pipelines only process new/changed rows",
    status: "working",
    branch: "feat/incremental",
    latestSessionId: "sess-004",
    dependsOn: [],
    reviewNotes: undefined,
    sortOrder: 2,
    createdAt: "2026-02-26T08:30:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: ["task-007a", "task-007b"],
    canDecompose: true,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  // ── Children of task-007 ───────────────────────────
  {
    id: "task-007a",
    workspaceId: "proj-beta",
    title: "Design watermark storage",
    description: "Define schema for per-pipeline high-watermark tracking",
    status: "complete",
    branch: "feat/incremental/design-watermark-storage",
    latestSessionId: "",
    dependsOn: [],
    reviewNotes: undefined,
    sortOrder: 1,
    createdAt: "2026-02-26T08:35:00Z",
    parentTaskId: "task-007",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  {
    id: "task-007b",
    workspaceId: "proj-beta",
    title: "Implement change detection query",
    description: "Generate WHERE clauses from watermarks to fetch only changed rows",
    status: "failed",
    branch: "feat/incremental/implement-change-detection-query",
    latestSessionId: "",
    dependsOn: ["task-007a"],
    reviewNotes: undefined,
    sortOrder: 2,
    createdAt: "2026-02-26T08:40:00Z",
    parentTaskId: "task-007",
    depth: 1,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
  {
    id: "task-008",
    workspaceId: "proj-beta",
    title: "Add pipeline monitoring dashboard",
    description: "Real-time metrics for pipeline throughput, latency, and error rates",
    status: "paused",
    branch: "feat/monitoring",
    latestSessionId: "",
    dependsOn: [],
    reviewNotes: undefined,
    sortOrder: 3,
    createdAt: "2026-02-26T09:00:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  },
];

// ─── Findings ───────────────────────────────────────

/** Sample findings across every category to exercise the FindingsPanel styling. */
export const MOCK_FINDINGS: FindingData[] = [
  {
    id: "find-001",
    workspaceId: "proj-alpha",
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
    workspaceId: "proj-alpha",
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
    workspaceId: "proj-alpha",
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
    workspaceId: "proj-alpha",
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
    workspaceId: "proj-alpha",
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
    workspaceId: "proj-alpha",
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
    workspaceId: "proj-beta",
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

// ─── Personas ───────────────────────────────────────

/** Sample personas demonstrating different agent specializations. */
export const MOCK_PERSONAS: PersonaData[] = [
  {
    id: "persona-arch",
    name: "Software Architect",
    description: "Designs system architecture, defines interfaces, and decomposes large features into implementable tasks.",
    systemPrompt: "You are a senior software architect. Focus on clean interfaces, separation of concerns, and scalable patterns. When decomposing work, create concrete subtasks with clear acceptance criteria.",
    toolConfig: JSON.stringify({ allowedTools: ["Read", "Grep", "Glob", "Write", "Edit"] }),
    runtime: "claude-code",
    model: "claude-sonnet-4-6",
    maxTurns: 50,
    mcpServers: "[]",
    createdAt: "2026-02-20T10:00:00Z",
    updatedAt: "2026-02-20T10:00:00Z",
    type: "agent",
    script: "",
    allowedMcpTools: ["task_create", "task_update", "task_list", "finding_post", "finding_list", "knowledge_search", "knowledge_create_node", "session_spawn"],
  },
  {
    id: "persona-fe",
    name: "Frontend Engineer",
    description: "React specialist — builds UI components, writes CSS, implements routing, and creates Playwright tests.",
    systemPrompt: "You are a frontend engineer specializing in React, TypeScript, and modern CSS. Follow component composition patterns, use semantic HTML, and write accessible markup.",
    toolConfig: JSON.stringify({ allowedTools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash"] }),
    runtime: "claude-code",
    model: "claude-sonnet-4-6",
    maxTurns: 100,
    mcpServers: "[]",
    createdAt: "2026-02-20T10:05:00Z",
    updatedAt: "2026-02-20T10:05:00Z",
    type: "agent",
    script: "",
    allowedMcpTools: [],
  },
  {
    id: "persona-reviewer",
    name: "Code Reviewer",
    description: "Reviews diffs for correctness, security, and style. Posts findings for issues discovered.",
    systemPrompt: "You are a meticulous code reviewer. Check for security vulnerabilities, performance issues, and style consistency. Post findings for anything noteworthy.",
    toolConfig: JSON.stringify({ allowedTools: ["Read", "Grep", "Glob"] }),
    runtime: "claude-code",
    model: "claude-sonnet-4-6",
    maxTurns: 30,
    mcpServers: "[]",
    createdAt: "2026-02-20T10:10:00Z",
    updatedAt: "2026-02-20T10:10:00Z",
    type: "agent",
    script: "",
    allowedMcpTools: ["finding_post", "finding_list", "knowledge_search"],
  },
  {
    id: "persona-tester",
    name: "QA Engineer",
    description: "Writes comprehensive test suites — unit tests, integration tests, and E2E Playwright specs.",
    systemPrompt: "You are a QA engineer focused on test coverage. Write tests that cover happy paths, edge cases, error scenarios, and accessibility. Use Playwright for E2E tests.",
    toolConfig: JSON.stringify({ allowedTools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash"] }),
    runtime: "claude-code",
    model: "claude-sonnet-4-6",
    maxTurns: 80,
    mcpServers: "[]",
    createdAt: "2026-02-20T10:15:00Z",
    updatedAt: "2026-02-20T10:15:00Z",
    type: "agent",
    script: "",
    allowedMcpTools: [],
  },
  {
    id: "persona-lint",
    name: "Lint & Format",
    description: "Scripted persona — runs ESLint and Prettier on changed files, auto-fixes violations, and posts a findings summary.",
    systemPrompt: "",
    toolConfig: "{}",
    runtime: "genaiscript",
    model: "",
    maxTurns: 1,
    mcpServers: "[]",
    createdAt: "2026-02-21T09:00:00Z",
    updatedAt: "2026-02-21T09:00:00Z",
    type: "script",
    script: 'const files = env.files.filter(f => /\\.(ts|tsx|js)$/.test(f.filename));\nfor (const f of files) {\n  const eslintResult = await host.exec("npx", ["eslint", "--fix", f.filename]);\n  if (eslintResult.exitCode !== 0) {\n    env.findings.push({ category: "lint", title: `Lint issues in ${f.filename}`, content: eslintResult.stderr });\n  }\n  const prettierResult = await host.exec("npx", ["prettier", "--write", f.filename]);\n  if (prettierResult.exitCode !== 0) {\n    env.findings.push({ category: "format", title: `Prettier issues in ${f.filename}`, content: prettierResult.stderr });\n  }\n}\nenv.findings.push({ category: "summary", title: "Lint & format pass complete", content: `Ran ESLint and Prettier on ${files.length} files` });',
    allowedMcpTools: [],
  },
];

// ─── Task Sessions ──────────────────────────────────

/** Sample session history per task, showing multiple attempts. */
export const MOCK_TASK_SESSIONS: Record<string, Session[]> = {
  "task-001b": [
    {
      id: "sess-001-prev",
      environmentId: "env-local-01",
      runtime: "claude-code",
      status: "stopped",
      endReason: "interrupted",
      prompt: "Implement auth middleware",
      startedAt: "2026-02-26T14:00:00Z",
    },
    {
      id: "sess-001",
      environmentId: "env-local-01",
      runtime: "claude-code",
      status: "running",
      prompt: "Implement auth middleware",
      startedAt: "2026-02-27T08:15:00Z",
    },
  ],
  "task-006c": [
    {
      id: "sess-004",
      environmentId: "env-docker-01",
      runtime: "claude-code",
      status: "running",
      prompt: "Add compression options",
      startedAt: "2026-02-27T09:00:00Z",
    },
  ],
};

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
 * Pre-built scenarios that exercise different UI paths with rich event types.
 * Each scenario uses a mix of text, tool_use, tool_result, and usage events
 * to produce a realistic agent session experience.
 *
 * - Scenario A: straight-through to "completed" with tool calls
 * - Scenario B: pauses at "idle" for user confirmation, then resumes
 * - Scenario C: runs partway then hits a tool error and ends in "failed"
 */
export const MOCK_STREAM_SCENARIOS: MockStreamScenario[] = [
  // ── Scenario A — API Refactor (straight-through with tool calls) ──────
  {
    label: "API Refactor",
    pauseForInput: false,
    steps: [
      {
        delayMs: 0,
        event: { eventType: "status", timestamp: ts(0), content: "running" },
      },
      {
        delayMs: 600,
        event: {
          eventType: "text",
          timestamp: ts(600),
          content: "I'll start by finding all API route files that need refactoring.",
        },
      },
      {
        delayMs: 1200,
        event: {
          eventType: "tool_use",
          timestamp: ts(1200),
          content: JSON.stringify({ tool: "Glob", args: { pattern: "src/routes/**/*.ts" } }),
          raw: JSON.stringify({ id: "stream-a-01", type: "tool_use" }),
        },
      },
      {
        delayMs: 1600,
        event: {
          eventType: "tool_result",
          timestamp: ts(1600),
          content: "src/routes/users.ts\nsrc/routes/auth.ts\nsrc/routes/billing.ts\nsrc/routes/admin.ts\nsrc/routes/health.ts",
          raw: JSON.stringify({ tool_use_id: "stream-a-01" }),
        },
      },
      {
        delayMs: 2200,
        event: {
          eventType: "text",
          timestamp: ts(2200),
          content: "Found 5 route files. Let me refactor users.ts to use Express Router with a middleware chain.\n\n```typescript\nconst router = Router();\nrouter.use(authenticate);\nrouter.use(validateBody);\n\nrouter.get(\"/\", listUsers);\nrouter.post(\"/\", createUser);\nrouter.get(\"/:id\", getUser);\nrouter.put(\"/:id\", updateUser);\nrouter.delete(\"/:id\", deleteUser);\n```",
        },
      },
      {
        delayMs: 3200,
        event: {
          eventType: "tool_use",
          timestamp: ts(3200),
          content: JSON.stringify({ tool: "Bash", args: { command: "npm test -- --testPathPattern=routes" } }),
          raw: JSON.stringify({ id: "stream-a-02", type: "tool_use" }),
        },
      },
      {
        delayMs: 4000,
        event: {
          eventType: "tool_result",
          timestamp: ts(4000),
          content: " PASS  src/routes/__tests__/users.test.ts\n PASS  src/routes/__tests__/auth.test.ts\n PASS  src/routes/__tests__/billing.test.ts\n\nTest Suites: 3 passed, 3 total\nTests:       22 passed, 22 total",
          raw: JSON.stringify({ tool_use_id: "stream-a-02" }),
        },
      },
      {
        delayMs: 4500,
        event: {
          eventType: "usage",
          timestamp: ts(4500),
          content: JSON.stringify({ input_tokens: 28400, output_tokens: 7200, cost_usd: 0.15 }),
        },
      },
      {
        delayMs: 5000,
        event: {
          eventType: "text",
          timestamp: ts(5000),
          content: "All 22 tests pass. The route refactoring is complete.",
        },
      },
      {
        delayMs: 5500,
        event: { eventType: "status", timestamp: ts(5500), content: "completed" },
      },
    ],
  },

  // ── Scenario B — Database Migration (pause for input) ─
  {
    label: "Database Migration",
    pauseForInput: true,
    pauseAfterStep: 4,
    steps: [
      {
        delayMs: 0,
        event: { eventType: "status", timestamp: ts(0), content: "running" },
      },
      {
        delayMs: 600,
        event: {
          eventType: "text",
          timestamp: ts(600),
          content: "Scanning the current database schema to plan the migration.",
        },
      },
      {
        delayMs: 1200,
        event: {
          eventType: "tool_use",
          timestamp: ts(1200),
          content: JSON.stringify({ tool: "Read", args: { file_path: "migrations/001_initial.sql" } }),
          raw: JSON.stringify({ id: "stream-b-01", type: "tool_use" }),
        },
      },
      {
        delayMs: 1800,
        event: {
          eventType: "tool_result",
          timestamp: ts(1800),
          content: "CREATE TABLE users (\n  id UUID PRIMARY KEY,\n  name TEXT NOT NULL,\n  email TEXT UNIQUE NOT NULL,\n  created_at TIMESTAMPTZ DEFAULT now()\n);\n\nCREATE TABLE sessions (\n  id UUID PRIMARY KEY,\n  user_id UUID REFERENCES users(id),\n  expires_at TIMESTAMPTZ NOT NULL\n);",
          raw: JSON.stringify({ tool_use_id: "stream-b-01" }),
        },
      },
      {
        delayMs: 2600,
        event: {
          eventType: "text",
          timestamp: ts(2600),
          content: "I found the tables to modify:\n  - **users**: add column `last_login_at`\n  - **sessions**: add index on `expires_at`\n  - **audit_log**: new table\n\nThis migration will add a NOT NULL column to the `users` table. The table has **50,000+ rows** which may lock the table briefly.\n\nPlease confirm to proceed.",
        },
      },
      // step index 4 is the last step before pause (indices 0-4)
    ],
    resumeSteps: [
      {
        delayMs: 500,
        event: {
          eventType: "text",
          timestamp: ts(0),
          content: "Proceeding with migration.",
        },
      },
      {
        delayMs: 1200,
        event: {
          eventType: "tool_use",
          timestamp: ts(700),
          content: JSON.stringify({ tool: "Bash", args: { command: "npm run migrate" } }),
          raw: JSON.stringify({ id: "stream-b-02", type: "tool_use" }),
        },
      },
      {
        delayMs: 2200,
        event: {
          eventType: "tool_result",
          timestamp: ts(1700),
          content: "Applying 002_add_last_login.sql... done\nApplying 003_sessions_index.sql... done\nApplying 004_audit_log.sql... done\n\n3 migrations applied successfully.",
          raw: JSON.stringify({ tool_use_id: "stream-b-02" }),
        },
      },
      {
        delayMs: 2800,
        event: {
          eventType: "text",
          timestamp: ts(2300),
          content: "All 3 migrations applied successfully. The `audit_log` table is ready.",
        },
      },
      {
        delayMs: 3200,
        event: { eventType: "status", timestamp: ts(2700), content: "completed" },
      },
    ],
  },

  // ── Scenario C — Test Writer (error/failed with tool error) ───────────
  {
    label: "Test Writer",
    pauseForInput: false,
    steps: [
      {
        delayMs: 0,
        event: { eventType: "status", timestamp: ts(0), content: "running" },
      },
      {
        delayMs: 600,
        event: {
          eventType: "text",
          timestamp: ts(600),
          content: "I'll generate tests for `src/services/billing.ts`. Let me read the implementation first.",
        },
      },
      {
        delayMs: 1200,
        event: {
          eventType: "tool_use",
          timestamp: ts(1200),
          content: JSON.stringify({ tool: "Read", args: { file_path: "src/services/billing.ts" } }),
          raw: JSON.stringify({ id: "stream-c-01", type: "tool_use" }),
        },
      },
      {
        delayMs: 1800,
        event: {
          eventType: "tool_result",
          timestamp: ts(1800),
          content: 'import { StripeClient } from "./stripe-client.js";\nimport type { Invoice, LineItem } from "../types/billing.js";\n\nexport class BillingService {\n  constructor(private stripe: StripeClient) {}\n\n  async calculateMonthlyTotal(userId: string): Promise<number> {\n    const invoices = await this.stripe.listInvoices(userId);\n    return invoices.reduce((sum, inv) => sum + inv.total, 0);\n  }\n}',
          raw: JSON.stringify({ tool_use_id: "stream-c-01" }),
        },
      },
      {
        delayMs: 2400,
        event: {
          eventType: "text",
          timestamp: ts(2400),
          content: "The billing service imports from `./stripe-client.js`. Let me check if that module exists.",
        },
      },
      {
        delayMs: 2800,
        event: {
          eventType: "tool_use",
          timestamp: ts(2800),
          content: JSON.stringify({ tool: "Read", args: { file_path: "src/services/stripe-client.ts" } }),
          raw: JSON.stringify({ id: "stream-c-02", type: "tool_use" }),
        },
      },
      {
        delayMs: 3200,
        event: {
          eventType: "tool_result",
          timestamp: ts(3200),
          content: "Error: ENOENT: no such file or directory, open 'src/services/stripe-client.ts'",
          raw: JSON.stringify({ tool_use_id: "stream-c-02", is_error: true }),
        },
      },
      {
        delayMs: 3600,
        event: {
          eventType: "error",
          timestamp: ts(3600),
          content: "Cannot resolve import 'src/services/stripe-client.ts' — module not found. The billing service depends on a Stripe client that doesn't exist in this environment.",
        },
      },
      {
        delayMs: 4000,
        event: { eventType: "status", timestamp: ts(4000), content: "failed" },
      },
    ],
  },

  // ── Scenario D — Fix Auth Bug (tool-heavy) ────────────
  {
    label: "Fix Auth Bug",
    pauseForInput: false,
    steps: [
      {
        delayMs: 0,
        event: { eventType: "status", timestamp: ts(0), content: "running" },
      },
      {
        delayMs: 600,
        event: {
          eventType: "text",
          timestamp: ts(600),
          content: "Let me investigate the authentication bug...",
        },
      },
      // Read file
      {
        delayMs: 1200,
        event: {
          eventType: "tool_use",
          timestamp: ts(1200),
          content: JSON.stringify({ tool: "Read", args: { file_path: "/src/middleware/auth.ts" } }),
          raw: JSON.stringify({ id: "tool-mock-001" }),
        },
      },
      {
        delayMs: 1800,
        event: {
          eventType: "tool_result",
          timestamp: ts(1800),
          content: 'import jwt from "jsonwebtoken";\nimport type { Request, Response, NextFunction } from "express";\n\nconst JWT_SECRET = process.env.JWT_SECRET || "change-me";\n\nexport function verifyToken(req: Request, res: Response, next: NextFunction): void {\n  const header = req.headers.authorization;\n  if (!header?.startsWith("Bearer ")) {\n    res.status(401).json({ error: "Missing token" });\n    return;\n  }\n  try {\n    const decoded = jwt.verify(header.slice(7), JWT_SECRET);\n    if (decoded.exp > Date.now() / 1000) {\n      res.status(403).json({ error: "Token expired" });\n      return;\n    }\n    req.user = decoded;\n    next();\n  } catch {\n    res.status(403).json({ error: "Invalid token" });\n  }\n}',
          raw: JSON.stringify({ tool_use_id: "tool-mock-001", is_error: false }),
        },
      },
      {
        delayMs: 2600,
        event: {
          eventType: "text",
          timestamp: ts(2600),
          content: "Found the issue — the token expiry check on line 14 is using `>` instead of `<`. A token is expired when `exp < now`, but the code checks `exp > now` which means it rejects *valid* tokens and accepts *expired* ones. Let me fix it.",
        },
      },
      // Edit file
      {
        delayMs: 3400,
        event: {
          eventType: "tool_use",
          timestamp: ts(3400),
          content: JSON.stringify({
            tool: "Edit",
            args: {
              file_path: "/src/middleware/auth.ts",
              old_string: "    if (decoded.exp > Date.now() / 1000) {",
              new_string: "    if (decoded.exp < Date.now() / 1000) {",
            },
          }),
          raw: JSON.stringify({ id: "tool-mock-002" }),
        },
      },
      {
        delayMs: 4000,
        event: {
          eventType: "tool_result",
          timestamp: ts(4000),
          content: "File updated successfully",
          raw: JSON.stringify({ tool_use_id: "tool-mock-002", is_error: false }),
        },
      },
      // Run tests
      {
        delayMs: 4600,
        event: {
          eventType: "tool_use",
          timestamp: ts(4600),
          content: JSON.stringify({ tool: "Bash", args: { command: "npm test -- --grep auth" } }),
          raw: JSON.stringify({ id: "tool-mock-003" }),
        },
      },
      {
        delayMs: 5800,
        event: {
          eventType: "tool_result",
          timestamp: ts(5800),
          content: "[exit 0] > jest --grep auth\n\n PASS  src/auth.test.ts\n  ✓ validates JWT token (12ms)\n  ✓ rejects expired token (3ms)\n  ✓ handles missing header (1ms)\n\nTests: 3 passed, 3 total\nTime:  1.234s",
          raw: JSON.stringify({ tool_use_id: "tool-mock-003", is_error: false }),
        },
      },
      // Search for other occurrences
      {
        delayMs: 6400,
        event: {
          eventType: "tool_use",
          timestamp: ts(6400),
          content: JSON.stringify({ tool: "Grep", args: { pattern: "decoded\\.exp", path: "src/" } }),
          raw: JSON.stringify({ id: "tool-mock-004" }),
        },
      },
      {
        delayMs: 7000,
        event: {
          eventType: "tool_result",
          timestamp: ts(7000),
          content: "src/middleware/auth.ts:14:    if (decoded.exp < Date.now() / 1000) {\nsrc/utils/token-refresh.ts:28:    const remaining = decoded.exp - Date.now() / 1000;",
          raw: JSON.stringify({ tool_use_id: "tool-mock-004", is_error: false }),
        },
      },
      {
        delayMs: 7800,
        event: {
          eventType: "text",
          timestamp: ts(7800),
          content: "Fixed. The token expiry comparison was inverted — `decoded.exp > Date.now()` should have been `<` (a token is expired when its `exp` is in the past). The other occurrence in `token-refresh.ts` uses subtraction (not comparison), so it was already correct. All 3 auth tests pass.",
        },
      },
      {
        delayMs: 8400,
        event: {
          eventType: "usage",
          timestamp: ts(8400),
          content: JSON.stringify({ input_tokens: 42600, output_tokens: 1850, cost_usd: 0.12 }),
        },
      },
      {
        delayMs: 8800,
        event: { eventType: "status", timestamp: ts(8800), content: "completed" },
      },
    ],
  },
];
