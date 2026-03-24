# Grackle Security Audit Report

**Date:** 2026-03-22
**Scope:** Full codebase — all 8 packages (`server`, `web`, `cli`, `powerline`, `adapter-sdk`, `common`, `mcp`, `knowledge-core`)
**Method:** Automated multi-agent source code review with deep-dive verification of each finding

---

## Executive Summary

The Grackle codebase has a **solid security foundation** with several well-implemented controls: constant-time API key comparison, AES-256-GCM token encryption at rest, PKCE-enforced OAuth, robust static file path traversal protection, and properly scoped session cookies (HttpOnly + SameSite). However, the audit identified **3 high-severity issues**, **6 medium-severity issues**, and **5 low-severity items** that warrant attention. The most critical finding is a workspace authorization bypass in the MCP knowledge search that allows scoped agents to access data across workspace boundaries.

### Findings Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| High | 3 | Workspace auth bypass, no WebSocket origin check, no spawned-process resource limits |
| Medium | 6 | PowerLine no-auth fallback, missing HTTP security headers, rate limiting gaps, credential exposure |
| Low | 5 | Session cookie Secure flag, SSH host key policy, default dev credentials, minor input validation |
| Informational | 3 | Defense-in-depth gaps, positive security controls noted |

---

## High Severity

### H-1. Workspace Authorization Bypass in `knowledge_search`

| Field | Value |
|-------|-------|
| **Package** | `@grackle-ai/mcp` |
| **File** | `packages/mcp/src/tools/knowledge.ts:146-169` |
| **CWE** | CWE-284 (Improper Access Control) |
| **Status** | Confirmed |

**Description:** The `knowledge_search` MCP tool is visible to scoped agents (included in `SCOPED_TOOLS` at `tool-scoping.ts:11`) but its handler does **not receive `authContext`** and does **not enforce workspace scoping**. A scoped agent can supply an arbitrary `workspaceId` parameter to search knowledge nodes in other workspaces.

**Contrast with correct implementation:** `knowledge_create_node` (same file, lines 334-357) properly receives `authContext` and overrides the user-supplied `workspaceId` for scoped callers:
```typescript
const resolvedWorkspaceId =
  authContext?.type === "scoped"
    ? authContext.workspaceId ?? ""
    : workspaceId ?? "";
```

`knowledge_search` lacks this pattern entirely — it passes `workspaceId: workspaceId ?? ""` directly to the backend at line 168.

**Same issue affects:** `knowledge_get_node` (lines 244-283) — also in `SCOPED_TOOLS` but lacks `authContext`.

**Impact:** Cross-workspace data leakage. A scoped agent in Workspace A can read knowledge graph nodes from Workspace B.

**Recommendation:** Add `authContext` parameter to `knowledge_search` and `knowledge_get_node` handlers and enforce workspace scoping, matching the pattern used in `knowledge_create_node`.

---

### H-2. Missing WebSocket Origin Header Validation

| Field | Value |
|-------|-------|
| **Package** | `@grackle-ai/server` |
| **File** | `packages/server/src/ws-bridge.ts:80-91` |
| **CWE** | CWE-346 (Origin Validation Error) |
| **Status** | Confirmed |

**Description:** The WebSocket upgrade handler validates authentication (API key token or session cookie) but does **not check the `Origin` header**. A malicious webpage on a different origin could initiate a WebSocket connection to `ws://localhost:3000/ws` if it can obtain a valid session cookie (which is `SameSite=Lax`, allowing top-level navigations).

```typescript
// Current code — no origin check
wss.on("connection", (ws, req) => {
  const token = url.searchParams.get("token") || "";
  const hasValidToken = token.length > 0 && verifyApiKey(token);
  const hasValidCookie = validateCookie?.(req.headers.cookie || "") ?? false;
  if (!hasValidToken && !hasValidCookie) {
    ws.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
    return;
  }
  // ... accepts connection without checking req.headers.origin
});
```

**Impact:** Cross-origin WebSocket hijacking. If a user visits a malicious site while a Grackle session is active, the attacker's page could open a WebSocket and subscribe to real-time events (session output, task updates, environment state).

**Recommendation:** Validate `req.headers.origin` against an allowlist of expected origins (e.g., `http://127.0.0.1:*`, `http://localhost:*`) before accepting the connection.

---

### H-3. No Resource Limits on Spawned Agent Processes

| Field | Value |
|-------|-------|
| **Package** | `@grackle-ai/powerline` |
| **Files** | `packages/powerline/src/runtimes/acp.ts:295-300`, `packages/powerline/src/runtimes/genaiscript.ts:117` |
| **CWE** | CWE-400 (Uncontrolled Resource Consumption) |
| **Status** | Confirmed |

**Description:** Agent child processes (Claude Code, Codex, Copilot, GenAIScript) are spawned via `child_process.spawn()` without any resource constraints:

```typescript
this.child = spawn(this.config.command, this.config.args, {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: spawnCwd,
  env: childEnv,
  shell: process.platform === "win32",
});
```

No `timeout`, no `maxBuffer` on pipes, no CPU/memory limits (cgroups, ulimits), and no maximum concurrent session count.

**Impact:** A runaway agent session can exhaust all system memory, CPU, or file descriptors, causing denial of service to the PowerLine server and all other sessions on the machine.

**Recommendation:**
- Add a configurable `timeout` to spawned processes (e.g., 60-minute default)
- Set `--max-old-space-size` for Node.js-based runtimes
- Implement a maximum concurrent session count in the session manager
- Consider process groups or cgroups for resource isolation

---

## Medium Severity

### M-1. PowerLine Runs Without Authentication by Default

| Field | Value |
|-------|-------|
| **Package** | `@grackle-ai/powerline` |
| **File** | `packages/powerline/src/index.ts:46, 63-76` |
| **CWE** | CWE-306 (Missing Authentication for Critical Function) |
| **Status** | Confirmed |

**Description:** When `--token` is not provided and `GRACKLE_POWERLINE_TOKEN` is not set, the PowerLine gRPC server runs with **zero authentication**. A warning is logged (`"NO AUTH (development only)"`) but nothing prevents deployment in this state. Any client that can reach the port can spawn sessions, access tokens, and execute code.

**Mitigating factor:** PowerLine binds to `127.0.0.1` by default and is typically accessed only through SSH tunnels established by the server.

**Recommendation:** Require an explicit `--no-auth` flag to run without authentication, rather than defaulting to no auth when the token is empty.

---

### M-2. Missing Content-Security-Policy and X-Frame-Options Headers

| Field | Value |
|-------|-------|
| **Package** | `@grackle-ai/server` |
| **File** | `packages/server/src/index.ts` (all `writeHead` calls) |
| **CWE** | CWE-693 (Protection Mechanism Failure) |
| **Status** | Confirmed |

**Description:** The HTTP server does not set `Content-Security-Policy`, `X-Frame-Options`, or `X-Content-Type-Options` headers on any response. This reduces defense-in-depth against XSS, clickjacking, and MIME-sniffing attacks.

**Mitigating factor:** React-markdown is configured safely (no `rehypeRaw`, no `dangerouslySetInnerHTML`), and the Vite build does not generate source maps. The XSS attack surface is currently small.

**Recommendation:** Add security headers to all HTML responses:
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
```

---

### M-3. No Rate Limiting on OAuth Token and Registration Endpoints

| Field | Value |
|-------|-------|
| **Package** | `@grackle-ai/server` |
| **File** | `packages/server/src/index.ts:303-567` |
| **CWE** | CWE-307 (Improper Restriction of Excessive Authentication Attempts) |
| **Status** | Confirmed |

**Description:** The `/token`, `/authorize`, and `/register` OAuth endpoints have no rate limiting. The pairing endpoint (`/pair`) correctly implements per-IP rate limiting with `MAX_FAILED_ATTEMPTS = 5` (in `pairing.ts`), but this protection is not applied to other endpoints.

**Impact:** An attacker with network access can brute-force authorization codes (though they expire in 30 seconds), spam client registrations to exhaust the 100-client cap, or attempt refresh token attacks.

**Recommendation:** Apply the same per-IP rate limiting pattern from `pairing.ts` to the OAuth endpoints.

---

### M-4. Parked Session Memory Accumulation (No TTL)

| Field | Value |
|-------|-------|
| **Package** | `@grackle-ai/powerline` |
| **File** | `packages/powerline/src/session-mgr.ts:1-50` |
| **CWE** | CWE-401 (Memory Leak) |
| **Status** | Confirmed |

**Description:** When a gRPC stream disconnects, session events are "parked" in an in-memory `Map<string, AgentEvent[]>`. If the client never calls `DrainBufferedEvents`, these events are **never cleaned up** — there is no TTL, no periodic sweep, and no size limit.

```typescript
const parkedEvents: Map<string, AgentEvent[]> = new Map();
export function parkSession(sessionId: string, events: AgentEvent[]): void {
  parkedEvents.set(sessionId, events);  // No TTL, no cleanup
}
```

**Impact:** Over time (or via deliberate abuse), memory accumulates without bound.

**Recommendation:** Add a TTL-based cleanup interval (e.g., expire parked events after 5-10 minutes), similar to the pairing code cleanup pattern in `pairing.ts`.

---

### M-5. MCP Server Commands Passed to SDKs Without Validation

| Field | Value |
|-------|-------|
| **Packages** | `@grackle-ai/powerline`, `@grackle-ai/common` |
| **Files** | `packages/powerline/src/runtimes/runtime-utils.ts:258-299`, `packages/common/src/proto/grackle/grackle.proto:434-439` |
| **CWE** | CWE-78 (OS Command Injection) |
| **Status** | Confirmed — but execution delegated to external SDKs |

**Description:** The `McpServerConfig` proto message allows arbitrary `command` and `args` fields. When a Persona is created with MCP server configs, the PowerLine passes these values to external SDKs (Codex SDK, Copilot SDK, ACP SDK) **without any command validation or allowlisting**. Grackle itself does not spawn MCP servers — it delegates to SDKs — but if those SDKs execute the command field directly, this becomes a remote code execution vector.

**Mitigating factor:** Only authenticated users can create Personas. The attack requires a malicious or compromised user account.

**Recommendation:** Add a command allowlist or path validation before passing MCP server configs to SDKs. At minimum, log all MCP server command invocations for audit.

---

### M-6. GitHub Token Exposure in Remote Shell History

| Field | Value |
|-------|-------|
| **Package** | `@grackle-ai/adapter-sdk` |
| **File** | `packages/adapter-sdk/src/bootstrap.ts:375-395` |
| **CWE** | CWE-532 (Information Exposure Through Log Files) |
| **Status** | Confirmed |

**Description:** During bootstrap, Grackle captures `GITHUB_TOKEN` from the remote host by executing `printenv GITHUB_TOKEN` via SSH. This command appears in the remote shell's command history. The token is then written to `.env.sh` (with `chmod 600`) and passed as an environment variable to spawned processes.

**Mitigating factors:**
- `.env.sh` file permissions are restricted (0600)
- Git credential helper is properly cleaned up on environment destroy (`shared-operations.ts:30-48`)
- The exposure is inherent to the SSH execution model

**Recommendation:** Document this as a known limitation. Consider using `HISTCONTROL=ignorespace` or prefixing commands with a space to avoid shell history.

---

## Low Severity

### L-1. Missing `Secure` Flag on Session Cookie

| Field | Value |
|-------|-------|
| **File** | `packages/server/src/session.ts:76` |
| **Status** | Acceptable for localhost; add for `--allow-network` mode |

The session cookie is set with `HttpOnly; SameSite=Lax; Path=/` but no `Secure` flag. Since the server binds to `127.0.0.1` by default and uses HTTP (not HTTPS), this is acceptable. However, when `--allow-network` is used to bind to `0.0.0.0`, cookies could be transmitted over insecure connections.

**Recommendation:** Conditionally add `; Secure` when the server is running behind HTTPS or when `--allow-network` is enabled.

---

### L-2. SSH `StrictHostKeyChecking=accept-new`

| Field | Value |
|-------|-------|
| **File** | `packages/server/src/adapters/ssh.ts:54` |
| **Status** | Acceptable for development tool; document risk |

SSH connections use `StrictHostKeyChecking=accept-new`, which automatically accepts unknown host keys on first connection. This is vulnerable to MITM on the first connection attempt but is standard practice for development automation tools.

**Recommendation:** Document in security guidelines. For high-security deployments, recommend pre-populating `~/.ssh/known_hosts`.

---

### L-3. Default Neo4j Credentials in Knowledge-Core

| Field | Value |
|-------|-------|
| **File** | `packages/knowledge-core/src/constants.ts:21` |
| **Status** | Guarded by production check, but still a hardcoded credential |

```typescript
export const DEFAULT_NEO4J_PASSWORD: string = "grackle-dev";
```

A production guard exists (`NODE_ENV === "production"` throws an error), but staging or misconfigured environments could fall back to this weak password.

**Recommendation:** Remove the hardcoded default; always require `GRACKLE_NEO4J_PASSWORD` environment variable.

---

### L-4. Unescaped Error String in `renderPairingPage()`

| Field | Value |
|-------|-------|
| **File** | `packages/server/src/index.ts:64-89` |
| **Status** | Currently safe (all callers pass hardcoded strings) |

The `error` parameter is embedded into HTML without escaping: `${error}`. All current call sites pass hardcoded strings, so this is not exploitable today, but the function is architecturally fragile. Compare with `renderAuthorizePage()` which correctly uses `escapeHtml()`.

**Recommendation:** Apply `escapeHtml()` to the error parameter for defense-in-depth.

---

### L-5. JSON.parse Without try-catch in gRPC Service

| Field | Value |
|-------|-------|
| **File** | `packages/server/src/grpc-service.ts:415, 482, 498` |
| **Status** | Data is internally generated (database), but missing error handling |

`JSON.parse(env.adapterConfig)` is called without try-catch in three locations. The data originates from the server's own database, so it should always be valid JSON. However, database corruption or migration errors could cause crashes.

**Recommendation:** Wrap in try-catch and return a meaningful gRPC error instead of crashing.

---

## Informational

### I-1. Defense-in-Depth Gap: MCP Log Path Not Validated

`packages/mcp/src/tools/logs.ts:121,144` — The `logs_get` tool reads files at `session.logPath` without validating the path is within the expected logs directory. The backend is trusted, but adding path validation would protect against backend bugs. Note: `logs_get` is correctly excluded from `SCOPED_TOOLS`, preventing scoped agents from calling it.

### I-2. Docker Credential Helper Token Validation Works Correctly

The reported shell injection in `packages/server/src/adapters/docker.ts:151` is **mitigated** by the `SAFE_TOKEN_PATTERN` regex (`/^[a-zA-Z0-9_\-]+$/`) at line 178, which validates the GitHub token before it reaches the shell script. The validation is applied **before** the token is used, making the injection unexploitable.

### I-3. Positive Security Controls

The following security controls are well-implemented and should be maintained:

| Control | Location | Notes |
|---------|----------|-------|
| Constant-time API key comparison | `server/api-key.ts:55-67` | Bitwise XOR prevents timing attacks |
| Constant-time session signature | `server/session.ts:124-131` | HMAC-SHA256 with XOR comparison |
| AES-256-GCM token encryption | `server/crypto.ts` | 100K PBKDF2 iterations, per-token salt+IV |
| Static file path traversal check | `server/index.ts:206-207` | Dual check (relative + resolve) |
| Token writer symlink protection | `powerline/token-writer.ts:70-86` | Realpath ancestor check before mkdir |
| PKCE-enforced OAuth | `server/oauth.ts` | S256 code challenge required |
| OAuth redirect URI validation | `server/index.ts:316-332` | Strict loopback + http/https validation |
| File-based token permissions | `server/api-key.ts:30`, `powerline/token-writer.ts:94` | 0600 permissions on all credential files |
| Credential cleanup on destroy | `adapter-sdk/shared-operations.ts:30-48` | Git config, env file, and PID file removed |

---

## Rejected Findings (False Positives)

The following findings from the initial audit were investigated and determined to be non-issues:

| Initial Finding | Verdict | Reason |
|-----------------|---------|--------|
| Cypher injection via edge type | **Secure** | `EdgeType` is a closed union with runtime `assertValidEdgeType()` validation |
| npm install `shell:true` injection | **Low risk** | `runtimeDir` path is constructed from hardcoded `RUNTIME_MANIFESTS` keys |
| CLI `readFileSync` path traversal | **Not a vulnerability** | CLI runs as the user — reading user-specified files is intended behavior |
| Token writer TOCTOU | **Secure** | Realpath ancestor check properly mitigates the race window |
| Static file serving path traversal | **Robust** | Dual-check implementation (relative + resolve) is correct |
| OAuth redirect URI bypass | **Secure** | Strict loopback validation with exact-match redirect URI check |
| Markdown XSS in web UI | **Safe** | No `rehypeRaw`, no `dangerouslySetInnerHTML`; react-markdown sanitizes by default |
| Source map exposure | **Safe** | Vite defaults to `sourcemap: false` for production; not explicitly enabled |
| GenAIScript temp dir leak | **Handled** | Cleanup in `finally` block covers all exit paths |

---

## Recommendations Priority Matrix

### Immediate (Before Next Release)

1. **H-1: Fix workspace scoping in `knowledge_search` and `knowledge_get_node`** — Add `authContext` parameter and enforce workspace boundaries for scoped callers
2. **H-2: Add WebSocket Origin validation** — Check `req.headers.origin` before accepting connections
3. **L-4: Apply `escapeHtml()` in `renderPairingPage()`** — Quick fix for defense-in-depth

### Short-Term (1-2 Sprints)

4. **H-3: Add resource limits to spawned processes** — Timeout, memory caps, concurrent session limits
5. **M-4: Add TTL to parked sessions** — Prevent memory accumulation
6. **M-2: Add HTTP security headers** — CSP, X-Frame-Options, X-Content-Type-Options
7. **M-3: Rate-limit OAuth endpoints** — Apply the existing pairing rate-limit pattern

### Medium-Term (1 Month)

8. **M-1: Require explicit `--no-auth` for PowerLine** — Prevent accidental unauthenticated deployment
9. **M-5: Add MCP server command validation** — Allowlist or path validation before SDK delegation
10. **L-3: Remove hardcoded Neo4j password** — Require environment variable in all environments
11. **L-5: Add try-catch to JSON.parse calls** — Prevent crashes from database corruption

### Ongoing

12. **L-1: Add conditional `Secure` cookie flag** — When HTTPS or `--allow-network` is active
13. **L-2: Document SSH host key policy** — Security guidelines for production deployments
14. **M-6: Document token exposure in shell history** — Known limitation of SSH execution model
