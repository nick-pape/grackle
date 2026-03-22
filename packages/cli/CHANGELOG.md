# Change Log - @grackle-ai/cli

This log was last generated on Sun, 22 Mar 2026 04:43:26 GMT and should not be manually modified.

## 0.67.0
Sun, 22 Mar 2026 04:43:26 GMT

### Minor changes

- Wire knowledge graph into server lifecycle with opt-in initialization, event-driven entity sync, and graceful shutdown

### Patches

- Emit usage events from Copilot runtime via assistant.usage SDK event
- feat(server): SUSPENDED status on transport disconnect + auto-recovery of sessions on reconnect

## 0.66.0
Sun, 22 Mar 2026 04:14:36 GMT

### Minor changes

- Lifecycle streams for all sessions: auto-hibernate when last fd closed, killAgent via fd closure

## 0.65.0
Sun, 22 Mar 2026 03:46:09 GMT

### Minor changes

- Add knowledge graph MCP tools: knowledge_search, knowledge_get_node, knowledge_create_node

## 0.64.2
Sun, 22 Mar 2026 03:31:33 GMT

### Patches

- feat(powerline): session parking on disconnect — kill agent, buffer events, drain on reconnect

## 0.64.1
Sun, 22 Mar 2026 03:15:17 GMT

### Patches

- Add usage_get MCP tool for querying token usage and cost by scope

## 0.64.0
Sun, 22 Mar 2026 02:55:30 GMT

### Minor changes

- feat(common,powerline): add SUSPENDED session status and DrainBufferedEvents proto for graceful disconnect epic

### Patches

- Display task usage cost in overview tab with subtask tree rollup

## 0.63.0
Sun, 22 Mar 2026 02:21:37 GMT

### Minor changes

- Extract @grackle-ai/knowledge-core as a generic, reusable knowledge graph SDK

### Patches

- Add workspace usage display with loadUsage hook for server-side aggregation

## 0.62.2
Sun, 22 Mar 2026 01:37:20 GMT

### Patches

- Unify writeToFd delivery via stream-registry async listeners instead of direct sendInput

## 0.62.1
Sun, 22 Mar 2026 01:26:28 GMT

### Patches

- Add graph expansion (multi-hop traversal) to @grackle-ai/knowledge

## 0.62.0
Sun, 22 Mar 2026 00:48:48 GMT

### Minor changes

- Add reference node sync primitives for syncing Grackle entities to the knowledge graph

## 0.61.3
Sat, 21 Mar 2026 23:55:29 GMT

### Patches

- Display session usage in web UI session headers and environment detail with live streaming updates

## 0.61.2
Sat, 21 Mar 2026 23:43:23 GMT

### Patches

- Add integration tests for pipe delivery flow (async/sync delivery, cleanup, no-ops)

## 0.61.1
Sat, 21 Mar 2026 22:42:52 GMT

### Patches

- Add semantic vector search to @grackle-ai/knowledge

## 0.61.0
Sat, 21 Mar 2026 22:01:36 GMT

### Minor changes

- Make task_start pipe-aware: add pipe and parent_session_id to StartTaskRequest for structured IPC

## 0.60.0
Sat, 21 Mar 2026 21:49:59 GMT

### Minor changes

- Add GetUsage RPC for scoped usage rollups and render usage events as compact badges in web UI
- Add node and edge CRUD operations to the knowledge graph subsystem

### Patches

- fix(powerline): surface lazy runtime installer errors with actionable details instead of failing silently

## 0.59.1
Sat, 21 Mar 2026 21:09:49 GMT

### Patches

- Decompose UnifiedBar into ChatInput (page-owned) and ContextHintBar (page chrome)

## 0.59.0
Sat, 21 Mar 2026 21:01:20 GMT

### Minor changes

- Add ipc_list_fds MCP tool, GetSessionFds gRPC endpoint, and advisory fd cleanup instructions in system prompt
- Add Neo4j client, schema initialization, and domain types for the knowledge graph subsystem

### Patches

- Display session token usage and cost in status and task show commands
- Add session transcript chunker to @grackle-ai/knowledge

## 0.58.0
Sat, 21 Mar 2026 20:22:13 GMT

### Minor changes

- Add ipc_write and ipc_close MCP tools with WriteToFd and CloseFd gRPC endpoints

## 0.57.1
Sat, 21 Mar 2026 20:06:12 GMT

### Patches

- Emit usage events (input_tokens, output_tokens, cost_usd) from Claude Code runtime

## 0.57.0
Sat, 21 Mar 2026 19:53:31 GMT

### Minor changes

- Add ipc_spawn MCP tool with sync/async/detach pipe modes and WaitForPipe gRPC endpoint

### Patches

- Clean up UnifiedBar route matching for environment pages
- Add pluggable embedder interface with local ONNX implementation to @grackle-ai/knowledge
- Add chunker interface, pass-through chunker, and ingest pipeline to @grackle-ai/knowledge

## 0.56.3
Sat, 21 Mar 2026 18:26:26 GMT

### Patches

- Add session usage accounting: input_tokens, output_tokens, cost_usd columns with EVENT_TYPE_USAGE event processing
- Add @grackle-ai/knowledge package scaffold for the knowledge graph subsystem

## 0.56.2
Sat, 21 Mar 2026 18:10:39 GMT

### Patches

- Promote Environments to top-level page view, replacing the standalone Workspaces tab

## 0.56.1
Sat, 21 Mar 2026 17:58:15 GMT

### Patches

- Move task title and description from system prompt to user prompt so agents receive work instructions as the first message

## 0.56.0
Sat, 21 Mar 2026 17:06:15 GMT

### Minor changes

- Add orchestrator system prompt template with task tree, persona roster, environments, and decomposition guidelines
- Install runtime SDK packages lazily at spawn time instead of bundling all 8 as hard dependencies, reducing provisioning time and disk usage

## 0.55.0
Sat, 21 Mar 2026 16:01:10 GMT

### Minor changes

- Add stream-registry: in-memory streams and subscriptions model for agent IPC

## 0.54.1
Sat, 21 Mar 2026 15:32:23 GMT

### Patches

- Allow sendInput while agent is running by only rejecting terminal session statuses

## 0.54.0
Sat, 21 Mar 2026 14:51:13 GMT

### Minor changes

- Add HIBERNATING session status and parentSessionId column for streams IPC model
- Add pipe field to SpawnRequest proto and PipeMode type for streams IPC

### Patches

- Fix System task chat: use user message as prompt instead of title, handle read-only SDK config dir, recover session state on sendInput failure

## 0.53.5
Sat, 21 Mar 2026 05:03:11 GMT

### Patches

- Serialize sendInput follow-ups via input queue to prevent concurrent executeFollowUp calls

## 0.53.4
Fri, 20 Mar 2026 23:34:14 GMT

### Patches

- Extract injectable interfaces and pure functions from github-import.ts to separate fetch, transform, and persist phases

## 0.53.3
Fri, 20 Mar 2026 23:15:27 GMT

### Patches

- Inject database dependency into credential-providers for testability
- Add _setAcpSdkForTesting injection hook for real setupSdk() test coverage

## 0.53.2
Fri, 20 Mar 2026 22:15:12 GMT

### Patches

- Extract injectable ProcessFactory and PortProbe into tunnel adapters for testability

## 0.53.1
Fri, 20 Mar 2026 22:05:09 GMT

### Patches

- Extract GitRepository and WorkspaceLocator interfaces from runtime-utils for injectable testing
- Make waitForLocalPort() injectable with PortProber interface for testability

## 0.53.0
Fri, 20 Mar 2026 21:06:17 GMT

### Minor changes

- Add update_environment WS handler and full-page environment create/edit panel

### Patches

- Extract GitExecutor and WorktreeFileSystem interfaces from worktree.ts for dependency injection
- Extract buildEnvFileContent() as a public pure function from adapter-sdk bootstrap helpers

### Updates

- Extract injectable seams (ProcessFactory, PortProbe) from local-powerline for testability

## 0.52.4
Fri, 20 Mar 2026 16:16:43 GMT

### Patches

- Serve favicon, manifest, and logo assets without requiring session auth

## 0.52.3
Fri, 20 Mar 2026 15:25:10 GMT

### Patches

- Extract injectable FileSystem interface from token-writer for improved testability

### Updates

- Web-only: add sidebar view switcher with global task tree

## 0.52.2
Fri, 20 Mar 2026 14:48:26 GMT

### Patches

- Move initDatabase() off import-time execution for testability
- Harden parseWsMessage to return a discriminated WsMessage | GrackleEvent union, replacing the unsafe type-widening hack

## 0.52.1
Fri, 20 Mar 2026 14:30:15 GMT

### Patches

- Normalize IPv6 literals in GRACKLE_DOCKER_HOST by wrapping them in brackets for well-formed URLs

## 0.52.0
Fri, 20 Mar 2026 08:47:53 GMT

### Minor changes

- Add operations dashboard and home route UX

## 0.51.0
Fri, 20 Mar 2026 05:25:01 GMT

### Minor changes

- Refactor system prompt into SystemPromptBuilder, inject via native SDK mechanisms, add EVENT_TYPE_SIGNAL for signal event rendering

## 0.50.1
Fri, 20 Mar 2026 04:35:17 GMT

### Patches

- Make CLI API key loading injectable and throw instead of process.exit

### Updates

- Add unit tests for resolveAncestorEnvironmentId

## 0.50.0
Fri, 20 Mar 2026 04:17:00 GMT

### Minor changes

- Add root task (PID 0), System persona, and /chat tab for conversational orchestration

## 0.49.0
Fri, 20 Mar 2026 04:01:06 GMT

### Minor changes

- Expose persona_list and persona_show MCP tools to scoped-token agents

### Patches

- Remove dead GetDiff RPC, PowerLine handler, and task_diff WebSocket handler

## 0.48.0
Thu, 19 Mar 2026 19:33:07 GMT

### Minor changes

- Reparent workspaces under environments: workspaces now require an environment_id, env deletion is blocked when child workspaces exist, and ListWorkspaces supports filtering by environment

## 0.47.1
Thu, 19 Mar 2026 18:56:01 GMT

### Patches

- fix: pass worktreeBasePath to PowerLine when worktrees disabled, normalize localhost in MCP OAuth audience check

## 0.47.0
Thu, 19 Mar 2026 16:27:42 GMT

### Minor changes

- Rename Project to Workspace across all packages (proto, server, CLI, MCP, web UI, PowerLine)

## 0.46.0
Thu, 19 Mar 2026 14:39:39 GMT

### Minor changes

- Add splash screen during first-run experience to prevent main app flash, add grackle logo to FRE and docs site

## 0.45.1
Thu, 19 Mar 2026 14:01:06 GMT

### Patches

- Replace browser prompt() with inline project creation in welcome CTA

### Updates

- placeholder

## 0.45.0
Thu, 19 Mar 2026 12:25:13 GMT

### Minor changes

- Add stop_task WebSocket message that kills session and marks task complete in one step
- Expose task_start, task_complete, and session_send_input for scoped agents with descendant enforcement; add environment inheritance for startTask

## 0.44.0
Thu, 19 Mar 2026 07:29:14 GMT

### Minor changes

- Add script persona support with --type, --script, and --script-file flags for persona create/edit, and Type column in persona list

## 0.43.0
Thu, 19 Mar 2026 07:05:32 GMT

### Minor changes

- feat: SIGCHLD child completion notifications, --can-decompose and --parent CLI flags, MCP canDecompose field, web UI checkbox

### Updates

- placeholder

## 0.42.0
Thu, 19 Mar 2026 05:48:47 GMT

### Minor changes

- Make project_id nullable on tasks — tasks can now be created without a project

### Updates

- placeholder
- Add phased build scripts and rush-project.json for Rush build cache and parallel CI

## 0.41.1
Wed, 18 Mar 2026 21:54:32 GMT

### Patches

- Lockstep version bump (no CLI changes)

### Updates

- No user-facing CLI changes (web-only refactor of editable field components)

## 0.41.0
Wed, 18 Mar 2026 20:54:11 GMT

### Minor changes

- Add runtime_session_id to AgentEventType union for persisting runtime-native session IDs
- Emit runtime_session_id event from all runtimes (claude-code, copilot, codex, acp, stub) so the server can persist the runtime-native session ID
- Add status-aware resumeAgent: terminal sessions are reanimated in-place; active sessions return FailedPrecondition. Persist runtimeSessionId via event processor.

### Updates

- No user-facing CLI changes; lockstep version bump only.
- No CLI changes (lockstep versioning entry)

## 0.40.0
Wed, 18 Mar 2026 13:51:51 GMT

### Minor changes

- Replace ad-hoc runtime/model resolution with persona cascade at app/project/task levels

## 0.39.1
Wed, 18 Mar 2026 13:38:45 GMT

### Patches

- Worktrees now fetch from origin and branch from the remote default branch so agents start on up-to-date code (falls back to local HEAD if fetch fails)

### Updates

- No CLI changes (pnpm-lock merge artifact)

## 0.39.0
Wed, 18 Mar 2026 05:13:05 GMT

### Minor changes

- Add ACP (Agent Client Protocol) runtimes alongside existing SDK runtimes for codex, copilot, and claude-code
- feat: Docker-out-of-Docker networking support for sibling containers (GRACKLE_DOCKER_NETWORK, GRACKLE_DOCKER_HOST env vars)

### Patches

- chore: remove grackle MCP entry from .mcp.json (use user-level OAuth config instead)

### Updates

- No CLI changes — change file required by Rush merge-commit detection

## 0.38.2
Wed, 18 Mar 2026 04:44:23 GMT

### Patches

- fix: defer task-created toast until server confirms; add create_task_error WS message; add provisioning environment toast

### Updates

- placeholder

## 0.38.1
Wed, 18 Mar 2026 04:06:45 GMT

### Patches

- Use ConnectError with proper gRPC status codes instead of plain Error in grpc-service.ts

### Updates

- placeholder

## 0.38.0
Tue, 17 Mar 2026 18:17:47 GMT

### Minor changes

- Auto-parent subtasks from agent context; expose task_list and task_show to scoped agents

## 0.37.0
Tue, 17 Mar 2026 15:03:49 GMT

### Minor changes

- Auto-start local PowerLine when Grackle server starts

### Updates

- Upgrade to ESLint 9 flat config and remove stale eslint-disable directives
- Upgrade zod dependency to v4 (merge artifact — no CLI changes)
- Add API Extractor to heft build pipeline for API surface tracking

## 0.36.0
Tue, 17 Mar 2026 03:48:25 GMT

### Minor changes

- Extract @grackle-ai/adapter-sdk package with adapter interfaces, bootstrap logic, and tunnel management

### Updates

- No functional changes — merge commit false positive

## 0.35.1
Tue, 17 Mar 2026 03:26:49 GMT

### Patches

- Add GetSession RPC for direct session lookup by ID

## 0.35.0
Tue, 17 Mar 2026 03:20:19 GMT

### Minor changes

- Add useWorktrees field to project MCP tools (list, create, get, update)

## 0.34.1
Tue, 17 Mar 2026 01:31:02 GMT

### Patches

- Broadcast environment list to WebSocket clients after gRPC add/remove operations

### Updates

- No CLI changes — merge-commit false positive for lockstep versioning

## 0.34.0
Tue, 17 Mar 2026 00:33:11 GMT

### Minor changes

- Add OAuth authentication flow for MCP clients (browser-based authorization with PKCE)

## 0.33.0
Mon, 16 Mar 2026 18:27:18 GMT

### Minor changes

- Replace stdio MCP stub with in-process HTTP MCP broker for unified agent-to-platform tool access

## 0.32.0
Mon, 16 Mar 2026 14:30:53 GMT

### Minor changes

- Add CLI and MCP commands for credential provider configuration

## 0.31.2
Mon, 16 Mar 2026 06:43:40 GMT

### Patches

- Remove adapter-specific credential handling, deliver all credentials via pushTokens

### Updates

- Add a new kanban view

## 0.31.1
Mon, 16 Mar 2026 05:45:22 GMT

### Patches

- Remove --no-open flag and browser auto-open; server no longer opens browsers

### Updates

- placeholder
- No CLI changes — merge commit false positive

## 0.31.0
Mon, 16 Mar 2026 04:29:47 GMT

### Minor changes

- Add pairing-code session auth for secure LAN access. Server binds to 0.0.0.0, web UI uses session cookies, new `grackle pair` command.

## 0.30.0
Mon, 16 Mar 2026 03:56:16 GMT

### Minor changes

- Add fuzzy search utility (fuse.js wrapper) for client-side and server-side search

### Updates

- No CLI changes — change file addresses merge-commit false positive

## 0.29.1
Mon, 16 Mar 2026 00:01:13 GMT

### Patches

- Add CLI banner with ASCII bird art and polish help text descriptions

### Updates

- No CLI changes (merge artifact from main sync)

## 0.29.0
Sun, 15 Mar 2026 23:23:30 GMT

### Minor changes

- Add --search and --status filters to task list across proto, store, gRPC, WS, MCP, and CLI

## 0.28.0
Sun, 15 Mar 2026 21:27:25 GMT

### Minor changes

- Add configurable credential providers with opt-in toggles for Claude, GitHub, Copilot, and Codex credentials

### Updates

- Configurable credential providers for agent runtimes
- Add session-scoped authentication to MCP server (scoped tokens, auth middleware, revocation)

## 0.27.0
Sun, 15 Mar 2026 20:02:35 GMT

### Minor changes

- Simplify task/session lifecycle: 5 task statuses, 6 session statuses, replace approve/reject with complete/resume RPCs
- Add per-project worktree base path configuration

### Patches

- User-friendly codespace error messages, manual name fallback, optional machine type
- Add user-friendly error message for Node.js ABI version mismatch in better-sqlite3
- Add --host CLI flag to PowerLine, bind to 0.0.0.0 in Docker containers
- Add 11 new ESLint rules to shared heft-rig configs and fix all violations across all packages
- Show active tab in settings breadcrumbs
- Broadcast environment status changes from gRPC/heartbeat to WebSocket clients
- Add URL routing with react-router v7
- Escalate typedef and explicit-member-accessibility lint rules to error in common
- Grackle brand theme and system toggle

### Updates

- No CLI changes (merge commit false positive)

## 0.26.0
Sun, 15 Mar 2026 04:23:26 GMT

### Minor changes

- Decouple tasks from sessions: tasks are durable goals, sessions are ephemeral execution attempts. Task status computed from session history. Environment and persona selected at start time.

## 0.25.0
Sat, 14 Mar 2026 21:33:40 GMT

### Minor changes

- feat: late-bind session to task — add --session flag to task update, processor registry for mutable event context, and pre-association event replay

## 0.24.1
Sat, 14 Mar 2026 21:14:30 GMT

### Patches

- fix: load project settings on remote so Stop hook fires

### Updates

- Fix Copilot task stop action failing with internal error

## 0.24.0
Sat, 14 Mar 2026 14:08:18 GMT

### Minor changes

- Show tool results with preview + accordion in stream: success/error indicator, first 5 lines inline, click-to-expand for longer results

### Patches

- Forward raw field in WebSocket session events so clients can display is_error flag from tool results

### Updates

- No CLI changes — picking up server patch for raw field forwarding in WebSocket events

## 0.23.0
Sat, 14 Mar 2026 13:49:54 GMT

### Minor changes

- Add configurable worktree isolation per project: --no-worktrees flag for project create/update, project list shows worktree status

### Updates

- Fix Copilot task stop action failing with internal error

## 0.22.0
Sat, 14 Mar 2026 08:13:46 GMT

### Minor changes

- Allow editing persona and environment on pending tasks

## 0.21.0
Sat, 14 Mar 2026 08:04:11 GMT

### Minor changes

- Map full CLI tool surface to 35 MCP tools, add send-input/project get/update CLI commands, remove GetTaskDiff RPC

### Patches

- Re-push stored tokens and Claude credentials before each task start to prevent stale OAuth token failures

## 0.20.0
Sat, 14 Mar 2026 07:25:55 GMT

### Minor changes

- feat: import blocking/blocked-by relationships from GitHub Issues as task dependsOn arrays

## 0.19.0
Sat, 14 Mar 2026 05:55:32 GMT

### Minor changes

- Add MCP server core infrastructure with Streamable HTTP transport, tool registry, and proof-of-concept tools

### Updates

- No CLI changes; merge from main included unrelated CLI bump
- Add a none bump change file for @grackle-ai/cli because merge commits from origin/main make rush change --verify falsely detect CLI changes on this web-only PR.

## 0.18.3
Sat, 14 Mar 2026 04:23:29 GMT

### Patches

- Fix CLI connecting via IPv6 (::1) when server binds IPv4-only (127.0.0.1); change CLI default URL from localhost to 127.0.0.1, add --host flag to grackle serve, bind PowerLine to 127.0.0.1 explicitly, and reflect actual bind address in log messages

## 0.18.2
Sat, 14 Mar 2026 04:00:53 GMT

### Patches

- Add pnpm.onlyBuiltDependencies to allow better-sqlite3 install script in pnpm v8+

### Updates

- False positive — only @grackle-ai/web (non-publishable) was modified; merge-commit detection flagged this package.
- No changes to CLI (merge commit false positive)

## 0.18.1
Fri, 13 Mar 2026 21:32:39 GMT

### Patches

- Add the UpdateProject RPC and project detail view inline editing flow.

## 0.18.0
Fri, 13 Mar 2026 18:20:02 GMT

### Minor changes

- Add --no-include-comments flag to import-github command

### Updates

- Add breadcrumbs

## 0.17.1
Fri, 13 Mar 2026 17:07:19 GMT

### Patches

- Add --depends-on flag to task update CLI command

### Updates

- Address persona CLI UI gaps by adding missing tasks help and examples

## 0.17.0
Fri, 13 Mar 2026 08:26:43 GMT

### Minor changes

- Add waiting_input task status synced with session status

### Updates

- No CLI changes — false positive from Rush merge detection

## 0.16.0
Fri, 13 Mar 2026 07:19:57 GMT

### Minor changes

- feat: add task_id to sessions, track session history per task, display attempt selector in UI

### Updates

- none-bump change file for merge-commit false positive
- No changes to CLI (false positive from merge commits)
- No CLI changes — change file added to satisfy rush change --verify false positive from merge commits

## 0.15.1
Fri, 13 Mar 2026 05:32:15 GMT

### Patches

- Kill active sessions before task deletion in WS and gRPC handlers

### Updates

- Persona CLI commands (`persona list/create/show/edit/delete`), `--persona` flag on `spawn`, `task create`, and `task start`
- placeholder
- No CLI changes — merge commit false positive
- placeholder

## 0.15.0
Fri, 13 Mar 2026 00:56:54 GMT

### Minor changes

- Implements the Persona system foundation — proto definitions (#168), database schema + store (#170), and gRPC/WebSocket service handlers with spawn integration (#171). Personas are reusable agent templates containing system prompt, runtime/model config, tool config, and MCP server definitions.

### Updates

- No publishable changes
- No API changes (merge commit false positive)
- placeholder
- No CLI changes — merge commit false positive
- Merge commit false positive — no actual CLI changes
- No API changes (merge commit false positive)
- No publishable changes (merge commit false positive)

## 0.14.10
Thu, 12 Mar 2026 17:36:37 GMT

### Patches

- Add error handling to SendInput WebSocket handler: validate session existence and active status, check environment connection, and send descriptive error messages to the client instead of silently dropping input.

### Updates

- No changes (merge commit false positive)
- No changes (merge commit false positive)

## 0.14.9
Thu, 12 Mar 2026 15:30:40 GMT

### Patches

- Auto-retry task on rejection with review notes

## 0.14.8
Thu, 12 Mar 2026 15:00:24 GMT

### Patches

- Auto-detect git repo path for worktrees, add task update CLI, capture codespace git credentials

## 0.14.7
Thu, 12 Mar 2026 11:30:47 GMT

### Patches

- Remove proto enums that shadow hand-written string union types

### Updates

- No actual changes to this package

## 0.14.6
Thu, 12 Mar 2026 08:11:55 GMT

### Patches

- Harden add_environment input validation: port range [1,65535], adapterConfig double-encoding fix, ID collision retry loop

## 0.14.5
Thu, 12 Mar 2026 07:09:34 GMT

### Patches

- Allow retrying failed tasks by adding 'failed' to allowed start statuses

## 0.14.4
Thu, 12 Mar 2026 06:27:52 GMT

### Patches

- Fast reconnect: restart remote PowerLine (~8s) instead of full reprovision (~3min) when the process has stopped

## 0.14.3
Thu, 12 Mar 2026 06:04:15 GMT

### Patches

- Move import-github logic from CLI to server; CLI is now a thin RPC wrapper
- Fix false task failures when session disconnects while idle

## 0.14.2
Thu, 12 Mar 2026 05:17:32 GMT

### Patches

- Migrate cross-package dependencies to workspace:* protocol; bump MAX_TASK_DEPTH to 8; import shared constants from @grackle-ai/common instead of duplicating

## 0.14.1
Thu, 12 Mar 2026 02:00:22 GMT

### Patches

- Fix CD pipeline: rewrite version bump to push directly to main instead of creating temp branches and PRs

## 0.14.0
Thu, 12 Mar 2026 00:56:21 GMT

### Minor changes

- Add agent-initiated subtask creation via create_subtask MCP tool
- Unpublished changes from 0.13.1-0.15.0: import-github command, codespace environment picker, MCP script path fix, port conflict handling, decomposition rights, provision progress broadcast, bug fixes from live testing, review fixes

### Patches

- Resolve MCP script path relative to PowerLine package instead of hardcoded Docker path

### Updates

- No CLI changes — merge commit false positive
- No functional changes to CLI (merge commit false positive)
- No functional changes to CLI (merge commit false positive)
- No functional changes (merge commit artifact)

## 0.13.0
Tue, 10 Mar 2026 20:25:56 GMT

### Minor changes

- Add interactive DAG visualization for task dependency graphs

## 0.12.0
Tue, 10 Mar 2026 18:09:01 GMT

### Minor changes

- Add task tree hierarchy

## 0.11.2
Tue, 10 Mar 2026 15:57:59 GMT

### Patches

- Extract shared runtime utilities and BaseAgentRuntime to deduplicate PowerLine runtimes

## 0.11.1
Tue, 10 Mar 2026 14:35:26 GMT

### Patches

- Extract shared processEventStream to deduplicate event-processing loops
- Extract BaseAgentSession abstract class from ClaudeCodeSession and CodexSession to consolidate shared session lifecycle

### Updates

- Add unit tests for powerline package

## 0.11.0
Tue, 10 Mar 2026 08:23:27 GMT

### Patches

- Wire-proto-enums-to-message-fields

## 0.10.0
Tue, 10 Mar 2026 07:50:14 GMT

### Patches

- Fix ClaudeCodeSession.sendInput to use eventQueue and resumed query pattern

## 0.9.0
Tue, 10 Mar 2026 07:45:46 GMT

### Minor changes

- Add environment creation UI to web app

## 0.8.0
Tue, 10 Mar 2026 07:36:11 GMT

### Minor changes

- Add token management UI with settings page

## 0.7.0
Tue, 10 Mar 2026 07:31:32 GMT

### Patches

- Fix Codex runtime: sendInput race condition, resume sends junk prompt, resource leak on kill, disallowedTools ignored

## 0.6.0
Tue, 10 Mar 2026 07:13:31 GMT

### Patches

- Code quality sweep 4: SessionPanel stable keys, null guard, useEffect deps, mock state read via ref, shared remote adapter helpers

## 0.5.0
Tue, 10 Mar 2026 06:59:12 GMT

### Patches

- Code quality sweep 3: attach race fix, resume event logging, WS status handling, systemContext dedup, events cap

## 0.4.0
Tue, 10 Mar 2026 06:41:29 GMT

### Patches

- Code quality sweep 2: fail-fast API key, gRPC error handling, session cleanup, structured logging, slug collision fix, output event rendering

## 0.3.0
Tue, 10 Mar 2026 06:33:40 GMT

### Patches

- Code quality sweep: constant-time auth, deduplicate slugify, fix updateTask field clearing, remove dead exports

## 0.2.0
Tue, 10 Mar 2026 06:13:42 GMT

### Updates

- Add "codex" to RuntimeName type

## 0.1.0
Tue, 10 Mar 2026 06:04:37 GMT

### Minor changes

- Add CLI options for SSH and Codespace environment adapters.

## 0.0.6
Tue, 10 Mar 2026 06:01:07 GMT

### Patches

- Publish @grackle-ai/web and bundle it with the server so the web UI is available out of the box.

## 0.0.5
Tue, 10 Mar 2026 02:21:30 GMT

_Version update only_

## 0.0.4
Mon, 09 Mar 2026 23:17:39 GMT

_Version update only_

## 0.0.3
Mon, 09 Mar 2026 14:40:59 GMT

### Minor changes

- Add CLI options for SSH and Codespace environment adapters.

## 0.0.2
Sun, 08 Mar 2026 05:58:05 GMT

### Updates

- Rename npm scope from @grackle to @grackle-ai

