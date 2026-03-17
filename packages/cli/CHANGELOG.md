# Change Log - @grackle-ai/cli

This log was last generated on Tue, 17 Mar 2026 15:03:49 GMT and should not be manually modified.

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

