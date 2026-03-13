# Change Log - @grackle-ai/cli

This log was last generated on Fri, 13 Mar 2026 08:26:43 GMT and should not be manually modified.

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

