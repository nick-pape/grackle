# Dependency Tracking Plan for Grackle GitHub Backlog

**Date:** 2026-03-13
**Project:** `grackle-github-backlog`
**Total tasks:** ~100 imported from GitHub issues

## Problem

All GitHub issues have been imported into Grackle as tasks with parent/child hierarchy
(from GitHub epics), but no `dependsOn` edges have been set. The DAG view shows hierarchy
only — it doesn't show execution order or blocking relationships.

## Approach

### Methodology

1. **Analyzed each issue** by reading titles, descriptions, and GitHub context
2. **Grouped by epic** — Orchestration (#270), UX Audit (#282), Web UI (#272), Code Quality (#271/#273), Branding (#56), Bugs, Runtimes, Misc
3. **Identified intra-group dependencies** — proto→server→CLI→UI chains, test→feature dependencies
4. **Identified cross-epic dependencies** — orchestration proto needed before UX can surface features
5. **Minimized transitive deps** — only direct "cannot start until X is done" edges

### Rules Applied

- Proto/schema changes before server changes that consume them
- Server changes before CLI/UI changes that surface them
- Integration tests after all pieces they integrate
- Tracking epics depend on their leaf children (or are left dep-free as meta-issues)
- Cross-epic deps only where there's a genuine API/data dependency

---

## Task ID ↔ Issue # Mapping

| Task ID    | Issue | Short Title |
|------------|-------|-------------|
| `7bdc99ee` | #273  | Epic: Rushstack tooling |
| `60986893` | #4    | Switch CLI to ts-command-line |
| `a15cabae` | #5    | Add @rushstack/terminal |
| `07a83528` | #6    | Add API Extractor |
| `fb2763af` | #7    | Add ESLint |
| `38f7e3ba` | #11   | Allowlist agent tools |
| `457e41a7` | #13   | Knowledge graph |
| `cae6166b` | #28   | Runtime: Crush |
| `3120d023` | #29   | Runtime: Goose |
| `4ad74e0c` | #37   | Team mode |
| `f6a86586` | #38   | Swarm mode epic |
| `19c992f3` | #56   | Branding pass |
| `4e747372` | #271  | Epic: Code quality |
| `72fef618` | #76   | CLI: logs command perf |
| `65531fbd` | #103  | useGrackleSocket decompose |
| `a4eb233d` | #272  | Epic: Web UI features |
| `818d7ff2` | #111  | Wake sleeping env |
| `6e7697f9` | #113  | Resume suspended session |
| `ccdbea05` | #119  | Post finding manually |
| `2d558f08` | #270  | Epic: Orchestration |
| `aecc272a` | #146  | Persona system |
| `5d6fd48c` | #149  | Agent subtask creation |
| `cdd86bd2` | #150  | Task waiting state |
| `ffada369` | #151  | Escalation chain |
| `577db685` | #152  | Reconciliation loop |
| `c444f2c4` | #153  | Event/completion triggers |
| `48429b98` | #154  | Scheduled triggers |
| `ae9621c0` | #155  | Webhook triggers |
| `0527bbd9` | #156  | Hierarchical context scoping |
| `10783974` | #157  | Failure propagation |
| `101b4e27` | #158  | Environment scheduling |
| `8550196a` | #159  | Task tree visualization |
| `88ea76e3` | #160  | Finding scoping |
| `45ae9560` | #161  | Conversation history mgmt |
| `13363048` | #162  | Artifacts and handoff |
| `f7fd27dc` | #163  | Decomposition heuristics |
| `22f0bc0d` | #164  | Cross-branch dependencies |
| `4a9029cc` | #165  | Style mimic agent |
| `de6aff54` | #166  | Recruiter persona |
| `8be77438` | #167  | Self-improvement loop |
| `58f1536a` | #173  | Persona: Web UI selector |
| `64ea520c` | #174  | Persona: Web UI management |
| `27b3f2a3` | #175  | Persona: Integration tests |
| `0bc0211a` | #179  | Task tree: CLI |
| `2385fbdb` | #185  | Agent subtasks: Proto |
| `3e0a7b51` | #186  | Agent subtasks: Server |
| `ba28cc8f` | #187  | Agent subtasks: PowerLine |
| `f9c25a84` | #188  | Agent subtasks: System context |
| `5470a383` | #189  | Agent subtasks: Integration tests |
| `cfd97a59` | #191  | Waiting state: Proto |
| `8ce4d12f` | #192  | Waiting state: Server |
| `16a35694` | #193  | Waiting state: CLI |
| `7549ce9e` | #194  | Waiting state: Web UI |
| `70aeb97e` | #195  | Waiting state: Tests |
| `74ce5035` | #196  | Escalation: Proto |
| `2deec3c5` | #197  | Escalation: Database |
| `0b50eff1` | #198  | Escalation: Server |
| `b95bf8c0` | #199  | Escalation: PowerLine |
| `fae5915b` | #200  | Escalation: CLI |
| `790cdaea` | #201  | Escalation: Web UI |
| `ff7d02de` | #202  | Escalation: Tests |
| `c301b94a` | #203  | Reconciliation: Core loop |
| `4a37abf6` | #204  | Reconciliation: Stall detection |
| `ca68407e` | #205  | Reconciliation: State consistency |
| `efbeeab0` | #206  | Reconciliation: Auto-dispatch |
| `3c2424ff` | #207  | Reconciliation: Configuration |
| `adc9c918` | #208  | Reconciliation: Web UI |
| `2a39d570` | #209  | Reconciliation: Tests |
| `96eedd5a` | #218  | Copilot SDK ESM import |
| `e0b77d10` | #229  | Environment Affinity epic |
| `89903243` | #230  | Paused task state |
| `07d6b1b9` | #231  | Environment lease |
| `f27d0b99` | #232  | inheritEnvironment |
| `7598ed45` | #233  | Reconciliation lease expiry |
| `02c913c6` | #245  | Review queue |
| `aad76c9b` | #246  | CI/Copilot auto-trigger |
| `58fae51d` | #249  | Send input to agent |
| `fc870715` | #256  | Codespace reconnect |
| `e6b7270c` | #261  | Workspace hygiene |
| `b7f2feeb` | #265  | import-github sync |
| `dff6b234` | #275  | Logo and icon set |
| `ce2a992a` | #276  | Documentation website |
| `48e3015a` | #277  | GitHub social preview |
| `b4e155fc` | #278  | Package READMEs |
| `0f37e6fe` | #279  | CLI banner |
| `85d0aa7c` | #280  | Color palette |
| `12eeebf9` | #282  | UX Audit epic |
| `f370fe07` | #283  | UX: Navigation |
| `6a1ab368` | #284  | UX: Task Workflows |
| `af154790` | #285  | UX: Bottom Bar |
| `3a2e3703` | #286  | UX: Stream View |
| `45522141` | #287  | UX: Interaction Polish |
| `fabe4484` | #288  | UX: Visual & Layout |
| `712e1ad7` | #289  | UX: Missing Features |
| `2d75c47f` | #290  | UX: Bugs & Issues |
| `d5d2f853` | #292  | Dashboard |
| `cf0a91fa` | #293  | Settings hub |
| `5d219981` | #294  | Breadcrumb navigation |
| `b9554d58` | #295  | Unified task create/edit |
| `2ae29edc` | #296  | Project detail view |
| `536aade0` | #297  | Dependency management UI |
| `fa523493` | #298  | Project creation view |
| `99813e63` | #299  | Environment at start time |
| `c068fca6` | #300  | Bottom bar refactor |
| `835ae1f8` | #303  | Tool results preview |
| `f2d11eed` | #306  | Keyboard shortcuts |
| `0abc665d` | #310  | DAG view polish |
| `7cde3ed3` | #312  | Task status filter |
| `38306417` | #313  | Search |
| `55b0d6af` | #314  | Project-level findings |
| `c0594eae` | #340  | Agent self-termination |
| `d9d84994` | #341  | Orphaned test files |
| `22300144` | #342  | Automate rush change |
| `a2142cd7` | #343  | MCP tools for orchestrators |
| `b71fa154` | #344  | Long-lived event sessions |
| `f36153d4` | #345  | Unified event bus |
| `bc624432` | #346  | External trigger ingestion |
| `eb51df7e` | #347  | Agent escalation & handoff |
| `f5f56b98` | #354  | Delete confirmations |
| `4e189042` | #356  | Dev Box adapter |
| `a238f002` | #365  | Codespace idle timeout |
| `c12371ad` | #369  | JSONL investigation |
| `5e4f02e9` | #379  | Copilot review stop hook |
| `f48c65ab` | #380  | --delete-tasks flag |
| `64d7e7ec` | #393  | Reconnect credentials |
| `ef09a36f` | #381  | Orchestrator system prompt |
| `237c88c2` | #382  | Auto-resume parent |
| `86284a39` | #383  | Concurrency limits |
| `4d79171a` | #384  | Persona auto-selection |
| `49b91d25` | #385  | Decomposition budget |
| `017e734e` | #386  | Swarm dry-run |
| `9e3ea7f8` | #387  | Agent heartbeat |
| `322ca608` | #388  | Kanban board |
| `963189b7` | #389  | import-github comments |
| `b09ab509` | #391  | Manual reprovision |

---

## Dependency Graph

### Wave 0: Foundation (no dependencies)

These tasks can start immediately. All other tasks eventually depend on something in this wave.

**Orchestration proto/foundation:**
- `2385fbdb` #185 Agent subtasks: Proto
- `cfd97a59` #191 Waiting state: Proto
- `74ce5035` #196 Escalation: Proto
- `c0594eae` #340 Agent self-termination MCP tool
- `f36153d4` #345 Unified event bus
- `c301b94a` #203 Reconciliation: Core loop
- `aecc272a` #146 Persona system (partially implemented)

**Bugs (all independent):**
- `96eedd5a` #218, `fc870715` #256, `d9d84994` #341, `a238f002` #365, `64d7e7ec` #393

**Code quality (all independent):**
- `60986893` #4, `a15cabae` #5, `07a83528` #6, `fb2763af` #7, `72fef618` #76, `22300144` #342

**Branding foundation:**
- `dff6b234` #275 Logo, `85d0aa7c` #280 Color palette

**UX foundation (independent):**
- `b9554d58` #295 Unified task create/edit
- `c068fca6` #300 Bottom bar refactor
- `cf0a91fa` #293 Settings hub
- `2ae29edc` #296 Project detail view
- `d5d2f853` #292 Dashboard
- `835ae1f8` #303 Tool results preview
- `65531fbd` #103 useGrackleSocket decompose
- `f2d11eed` #306 Keyboard shortcuts
- `38306417` #313 Search
- `55b0d6af` #314 Project-level findings

**Web UI features (independent):**
- `818d7ff2` #111 Wake sleeping env
- `ccdbea05` #119 Post finding manually
- `58fae51d` #249 Send input to agent (note: better after #300)

**Runtimes (independent):**
- `cae6166b` #28, `3120d023` #29, `4e189042` #356

**Misc (independent):**
- `457e41a7` #13, `b7f2feeb` #265, `963189b7` #389, `c12371ad` #369
- `5e4f02e9` #379, `f48c65ab` #380, `38f7e3ba` #11

### Wave 1: Server/Database Layer

**Orchestration — server implementations (depend on their protos):**

| Task ID | Issue | Title | depends_on |
|---------|-------|-------|------------|
| `3e0a7b51` | #186 | Agent subtasks: Server | `2385fbdb` (#185 proto) |
| `8ce4d12f` | #192 | Waiting state: Server | `cfd97a59` (#191 proto) |
| `2deec3c5` | #197 | Escalation: Database | `74ce5035` (#196 proto) |
| `0b50eff1` | #198 | Escalation: Server | `74ce5035` (#196 proto), `2deec3c5` (#197 DB) |
| `ef09a36f` | #381 | Orchestrator system prompt | `aecc272a` (#146 persona), `2385fbdb` (#185 proto) |
| `4a37abf6` | #204 | Reconciliation: Stall detection | `c301b94a` (#203 core loop) |
| `ca68407e` | #205 | Reconciliation: Consistency | `c301b94a` (#203 core loop) |
| `89903243` | #230 | Paused task state | (none — proto change) |

**Branding applications:**
| Task ID | Issue | Title | depends_on |
|---------|-------|-------|------------|
| `ce2a992a` | #276 | Documentation website | `dff6b234` (#275 logo) |
| `48e3015a` | #277 | GitHub social preview | `dff6b234` (#275 logo) |
| `b4e155fc` | #278 | Package READMEs | `dff6b234` (#275 logo) |
| `0f37e6fe` | #279 | CLI banner | `85d0aa7c` (#280 palette) |

**UX — depends on foundation:**
| Task ID | Issue | Title | depends_on |
|---------|-------|-------|------------|
| `536aade0` | #297 | Dependency management UI | `b9554d58` (#295 unified create/edit) |
| `99813e63` | #299 | Environment at start time | `b9554d58` (#295 unified create/edit) |
| `fa523493` | #298 | Project creation view | `2ae29edc` (#296 project detail view) |

### Wave 2: PowerLine/CLI Layer

**Orchestration — PowerLine and CLI (depend on server):**

| Task ID | Issue | Title | depends_on |
|---------|-------|-------|------------|
| `ba28cc8f` | #187 | Agent subtasks: PowerLine | `3e0a7b51` (#186 server) |
| `a2142cd7` | #343 | MCP tools for orchestrators | `3e0a7b51` (#186 server) |
| `16a35694` | #193 | Waiting state: CLI | `8ce4d12f` (#192 server) |
| `b95bf8c0` | #199 | Escalation: PowerLine | `0b50eff1` (#198 server) |
| `fae5915b` | #200 | Escalation: CLI | `0b50eff1` (#198 server) |
| `efbeeab0` | #206 | Reconciliation: Auto-dispatch | `c301b94a` (#203 core), `4a37abf6` (#204 stall), `ca68407e` (#205 consistency) |
| `07d6b1b9` | #231 | Environment lease | `89903243` (#230 paused state) |
| `9e3ea7f8` | #387 | Agent heartbeat | `c301b94a` (#203 core loop) |
| `bc624432` | #346 | External trigger ingestion | `f36153d4` (#345 event bus) |

**Cross-epic — Persona Web UI (depends on orchestration persona system):**
| Task ID | Issue | Title | depends_on |
|---------|-------|-------|------------|
| `58f1536a` | #173 | Persona: Web UI selector | `aecc272a` (#146 persona system) |
| `64ea520c` | #174 | Persona: Web UI management | `aecc272a` (#146 persona system) |

### Wave 3: UI Layer & Compound Features

**Orchestration — Web UI surfaces + system context:**

| Task ID | Issue | Title | depends_on |
|---------|-------|-------|------------|
| `f9c25a84` | #188 | Agent subtasks: System context | `ba28cc8f` (#187 PowerLine), `ef09a36f` (#381 prompt) |
| `7549ce9e` | #194 | Waiting state: Web UI | `8ce4d12f` (#192 server) |
| `790cdaea` | #201 | Escalation: Web UI | `0b50eff1` (#198 server) |
| `3c2424ff` | #207 | Reconciliation: Configuration | `c301b94a` (#203), `4a37abf6` (#204), `ca68407e` (#205), `efbeeab0` (#206) |
| `adc9c918` | #208 | Reconciliation: Web UI | `3c2424ff` (#207 config) |
| `b71fa154` | #344 | Long-lived event sessions | `a2142cd7` (#343 MCP tools), `f36153d4` (#345 event bus) |
| `f27d0b99` | #232 | inheritEnvironment | `89903243` (#230), `07d6b1b9` (#231) |
| `eb51df7e` | #347 | Structured escalation | `0b50eff1` (#198 server), `b95bf8c0` (#199 PowerLine), `f36153d4` (#345 event bus) |
| `101b4e27` | #158 | Environment scheduling | `efbeeab0` (#206 auto-dispatch), `07d6b1b9` (#231 lease) |
| `86284a39` | #383 | Concurrency limits | `efbeeab0` (#206 auto-dispatch) |

**Cross-epic — UX features that depend on orchestration:**
| Task ID | Issue | Title | depends_on |
|---------|-------|-------|------------|
| `6e7697f9` | #113 | Resume suspended session | `8ce4d12f` (#192 waiting server) |
| `0abc665d` | #310 | DAG view polish | (none — standalone visual) |
| `322ca608` | #388 | Kanban board | (none — standalone view) |
| `5d219981` | #294 | Breadcrumb navigation | (none — standalone) |

### Wave 4: Integration Tests & Advanced Features

**Integration tests (depend on all pieces they test):**

| Task ID | Issue | Title | depends_on |
|---------|-------|-------|------------|
| `5470a383` | #189 | Subtask integration tests | `3e0a7b51` (#186), `ba28cc8f` (#187), `f9c25a84` (#188) |
| `70aeb97e` | #195 | Waiting state tests | `8ce4d12f` (#192), `16a35694` (#193), `7549ce9e` (#194) |
| `ff7d02de` | #202 | Escalation tests | `0b50eff1` (#198), `b95bf8c0` (#199), `fae5915b` (#200), `790cdaea` (#201) |
| `2a39d570` | #209 | Reconciliation tests | `4a37abf6` (#204), `ca68407e` (#205), `efbeeab0` (#206) |
| `27b3f2a3` | #175 | Persona integration tests | `aecc272a` (#146), `58f1536a` (#173), `64ea520c` (#174) |

**Advanced orchestration (depend on core features):**

| Task ID | Issue | Title | depends_on |
|---------|-------|-------|------------|
| `237c88c2` | #382 | Auto-resume parent | `8ce4d12f` (#192 waiting server), `f36153d4` (#345 event bus) |
| `c444f2c4` | #153 | Event/completion triggers | `8ce4d12f` (#192), `f36153d4` (#345) |
| `7598ed45` | #233 | Reconciliation lease expiry | `07d6b1b9` (#231), `f27d0b99` (#232), `c301b94a` (#203) |
| `4d79171a` | #384 | Persona auto-selection | `aecc272a` (#146), `a2142cd7` (#343) |
| `e6b7270c` | #261 | Workspace hygiene | `101b4e27` (#158 env scheduling) |

### Wave 5: Late-Stage Features

| Task ID | Issue | Title | depends_on |
|---------|-------|-------|------------|
| `48429b98` | #154 | Scheduled triggers | `c444f2c4` (#153 event triggers), `f36153d4` (#345 event bus) |
| `ae9621c0` | #155 | Webhook triggers | `bc624432` (#346 external triggers), `f36153d4` (#345 event bus) |
| `10783974` | #157 | Failure propagation | `237c88c2` (#382 auto-resume), `c444f2c4` (#153 event triggers) |
| `0527bbd9` | #156 | Hierarchical context scoping | `f9c25a84` (#188 system context), `ef09a36f` (#381 prompt) |
| `88ea76e3` | #160 | Finding scoping | `5470a383` (#189 subtask integration) |
| `45ae9560` | #161 | Conversation history | `b71fa154` (#344 event sessions) |
| `13363048` | #162 | Artifacts and handoff | `5470a383` (#189 subtask integration), `237c88c2` (#382 auto-resume) |
| `f7fd27dc` | #163 | Decomposition heuristics | `f9c25a84` (#188 system context), `ef09a36f` (#381 prompt) |
| `49b91d25` | #385 | Decomposition budget | `a2142cd7` (#343 MCP tools), `ef09a36f` (#381 prompt) |
| `aad76c9b` | #246 | CI/Copilot auto-trigger | `c444f2c4` (#153 triggers), `bc624432` (#346 external triggers) |
| `8550196a` | #159 | Task tree visualization | `8ce4d12f` (#192 waiting server) |
| `02c913c6` | #245 | Review queue | (none — standalone UX feature) |

### Wave 6: Future/Research

| Task ID | Issue | Title | depends_on |
|---------|-------|-------|------------|
| `017e734e` | #386 | Swarm dry-run | `f9c25a84` (#188), `ef09a36f` (#381), `49b91d25` (#385) |
| `22f0bc0d` | #164 | Cross-branch dependencies | `5470a383` (#189 subtask integration) |
| `4a9029cc` | #165 | Style mimic agent | `eb51df7e` (#347 escalation), `45ae9560` (#161 history) |
| `de6aff54` | #166 | Recruiter persona | `aecc272a` (#146 persona), `4d79171a` (#384 auto-selection) |
| `8be77438` | #167 | Self-improvement loop | `13363048` (#162 artifacts), `49b91d25` (#385 budget) |

### Tracking Epics (depend on their children)

These are meta/tracking issues. Setting their dependencies is optional — they won't be "started"
as tasks, they track completion of their children. I recommend leaving them dependency-free
and relying on the parent/child hierarchy which is already imported.

- `2d558f08` #270 Epic: Orchestration
- `12eeebf9` #282 UX Audit
- `a4eb233d` #272 Epic: Web UI features
- `4e747372` #271 Epic: Code quality
- `7bdc99ee` #273 Epic: Rushstack tooling
- `19c992f3` #56 Branding pass
- `f6a86586` #38 Swarm mode
- `4ad74e0c` #37 Team mode
- `f370fe07` #283, `6a1ab368` #284, `af154790` #285, `3a2e3703` #286
- `45522141` #287, `fabe4484` #288, `712e1ad7` #289, `2d75c47f` #290

### Deliberately No Dependencies (standalone work)

These tasks are genuinely independent — they can be done in any order:

**Bugs:** #218, #256, #341, #365, #393
**Code quality:** #4, #5, #6, #7, #76, #342
**Runtimes:** #28, #29, #356
**Misc:** #13, #265, #369, #379, #380, #389, #11
**UX standalone:** #292 (dashboard), #293 (settings), #295 (task create/edit), #296 (project detail),
#300 (bottom bar), #303 (tool results), #306 (shortcuts), #313 (search), #314 (findings view)

---

## Cross-Epic Dependency Highlights

These are the most important edges that connect different epics:

```
Orchestration → UX:
  #146 persona system    → #173 persona Web UI selector
  #146 persona system    → #174 persona Web UI management
  #192 waiting server    → #194 waiting state Web UI
  #192 waiting server    → #113 resume suspended session
  #198 escalation server → #201 escalation Web UI
  #207 recon config      → #208 reconciliation Web UI

UX → UX (cross-group):
  #295 task create/edit  → #297 dependency management UI
  #295 task create/edit  → #299 environment at start time
  #296 project detail    → #298 project creation view
```

---

## Execution Plan

### Option A: Node.js Script (Recommended)

Write a script that connects via WebSocket and sends `update_task` messages with the
dependency arrays. This is the fastest and most auditable approach.

### Option B: CLI Loop

Run `grackle task update <id>` with `--depends-on` for each task. Slower but simpler.

### Option C: Direct SQLite

Update the `depends_on` JSON column directly. Fast but bypasses validation and WebSocket
broadcast — UI won't update until refresh.

**Recommendation:** Option A. The script can:
1. Define the full dependency map as a JS object
2. Connect to WebSocket
3. Send updates in batches
4. Verify by re-fetching all tasks and checking `dependsOn` arrays

---

## Verification

After applying dependencies:
1. Run `grackle task list grackle-github-backlog` — verify `Deps` column shows counts
2. Open the DAG view in the web UI — dashed gray dependency edges should appear
3. Spot-check critical chains:
   - #185 proto → #186 server → #187 PowerLine → #188 context → #189 tests
   - #191 proto → #192 server → #193 CLI / #194 UI → #195 tests
   - #295 task create/edit → #297 dependency management UI
4. Verify no cycles (Grackle doesn't currently enforce this, but the DAG layout will break
   if there are cycles — Dagre will throw or produce odd layouts)

---

## Issue Overlaps & Deduplication Notes

Some newer issues (#340-387) overlap with or refine older issues:

| Old Issue | New Issue | Relationship |
|-----------|-----------|-------------|
| #153 Event triggers | #382 Auto-resume parent | #382 is detailed spec of #153's "auto-resume" behavior |
| #155 Webhook triggers | #346 External trigger ingestion | #346 is broader (Teams, Slack, CI, not just webhooks) |
| #151 Escalation chain | #347 Structured escalation | #347 builds on #151 with notification channels |
| #158 Env scheduling | #206 Auto-dispatch | #206 is the reconciliation-loop version of #158 |
| #149 Agent subtasks | #343 MCP orchestrator tools | #343 extends #149 with more tools |

These are NOT duplicates — the newer issues refine/extend the older ones.
Set dependencies so newer issues depend on older ones being done first.
