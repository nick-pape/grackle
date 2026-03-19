---
title: "Grackle Agent Kernel Architecture"
status: active
type: spec
---

# Grackle Agent Kernel Architecture

Grackle's primitives map directly to operating system kernel concepts. This is not a metaphor bolted on after the fact — the architecture evolved toward these patterns independently, and naming them sharpens the design. Sessions are processes. Tasks are durable jobs. Personas are program images. PowerLine is the hardware abstraction layer. Adapters are device drivers. Findings are shared memory. MCP is the syscall interface.

This RFC consolidates the kernel framing (#480), the task lifecycle epic (#462), the process model (#545), inter-agent networking (#544), and 71 related backlog issues into a single architectural document.

**Supersedes:** [2026-03-09-task-orchestration.md](2026-03-09-task-orchestration.md)

---

## 1. Why a Kernel

Traditional multi-agent frameworks fall into two traps: too simple (parallel task runners with no coordination) or too complex (bespoke orchestration logic that doesn't generalize). OS kernels solved the same class of problems decades ago — scheduling processes on limited hardware, managing shared resources, isolating failures, enabling communication — and arrived at primitives that compose.

Grackle borrows these primitives because they answer the right questions:

- **How do agents share a machine?** → Scheduling and resource limits
- **How do agents talk to each other?** → IPC (pipes, shared memory, signals)
- **How do we handle agent failures?** → Supervision trees, orphan adoption, cascade kill
- **How do we keep humans in the loop?** → Job control (fg/bg, Ctrl+C, wait)
- **How do agents access tools?** → Syscalls through a controlled interface

**Where the analogy diverges:** OS processes are deterministic; LLM agents are stochastic. Agents need review gates that processes don't. Agents share knowledge (findings), not memory addresses. Token budgets replace CPU time slices — you can't preempt an LLM mid-inference, but you can cap its spend.

---

## 2. Subsystem Map

| Kernel Subsystem | Grackle Equivalent | Status |
|---|---|---|
| Process (fork/exec/wait) | Session (spawn/resume/kill) | **Exists** |
| Durable job / batch | Task (with DAG dependencies) | **Exists** |
| Program image (exec) | Persona (system prompt + tools + runtime) | **Exists** (#146) |
| Threads | Multiple sessions per task | **Speculative** (#545) |
| Process groups / job control | Task trees with fg/bg | **Speculative** (#545) |
| Scheduler | Reconciliation loop + environment dispatch | **In progress** (#152, #158, #471) |
| Signals (SIGTERM, SIGCHLD, etc.) | Graceful shutdown, child notification, cascade kill | **In progress** (#468, #494–#497) |
| Exit status | Structured session result | **Planned** (#498) |
| Resource limits (cgroups) | Per-task token budgets | **Planned** (#499, #500) |
| Orphan adoption (init) | Orphan task policy | **Planned** (#496) |
| Shared memory / IPC | Findings system | **Exists** (#160) |
| Pipes | Session output → session input | **Speculative** (#545) |
| Message queues | Typed inter-task signals | **Planned** (#480) |
| Syscalls | MCP broker (tool access) | **In progress** (#420) |
| HAL (hardware abstraction) | PowerLine | **Exists** |
| Device drivers | Environment adapters (Docker, SSH, Codespace, Local) | **Exists** |
| File descriptors | Typed resource handles (env, widget, A2A conn) | **Speculative** (#545) |
| Network stack (TCP/IP) | A2A protocol for inter-agent networking | **Speculative** (#544) |
| Display server (Wayland) | Widget compositor for task UI output | **Speculative** (#542) |
| DNS / service discovery | Agent Card registry | **Speculative** (#544) |
| Filesystem | Artifact storage and handoff | **Planned** (#162) |
| Swap | Checkpoint-to-workpad for long contexts | **Speculative** (#480) |
| Multi-user / permissions | Multi-tenancy / RBAC | **Speculative** |
| init (PID 1) | Chat landing page / orchestrator | **Exists** |

---

## 3. Process Model

### 3.1 Sessions as Processes

A **session** is the fundamental unit of execution. It maps to an OS process: it has a lifecycle (spawn → running → waiting → completed/failed/killed), consumes resources (tokens, compute time), produces a stream of events (stdout/stderr), and can be signaled.

Today, sessions are tightly coupled to both tasks and environments. The kernel model calls for decoupling (#545):

- **Sessions without environments.** A planning or research session doesn't need a compute environment — it needs an LLM and context, not a Docker container. Separating sessions from resources means lightweight sessions can run without provisioning hardware.
- **Multiple sessions per task.** A task may need concurrent execution: a research agent and an implementation agent working on the same goal, sharing the task's context ("address space"). Each session is a thread within the task's process. (#545)
- **Sessions without tasks.** Ad-hoc agent sessions (the current `spawn` command) remain valid — they're the equivalent of running a command in a shell without submitting it as a batch job.

### 3.2 Tasks as Durable Jobs

A **task** is a durable unit of work with persistence, state tracking, and human oversight. Tasks survive session failures — if an agent crashes, the task remains and can be retried. Tasks form a DAG with two relationship types:

- **Parent-child hierarchy** — decomposition. "This task is made of these subtasks." Up to `MAX_TASK_DEPTH = 8` levels.
- **Dependencies** — sequencing. "This task can't start until that task finishes." Set by the parent, between siblings only (#164 explores cross-branch deps).

### 3.3 Task Lifecycle

```
pending → assigned → in_progress → review → done
                  ↘                    ↓
                   → failed           rejected → assigned (retry)
                  ↘
                   → waiting (children executing)
```

| State | Meaning | Transitions to |
|---|---|---|
| `pending` | Created, may be blocked by dependencies | `assigned` (deps met + scheduled) |
| `assigned` | Ready to run, environment selected | `in_progress` (agent spawned) |
| `in_progress` | Agent actively executing | `review`, `failed`, `waiting` |
| `waiting` | Parent parked while children execute (#150, #191, #192) | `in_progress` (children done → parent resumed) |
| `review` | Agent finished, awaiting human approval | `done` (approved), `assigned` (rejected) |
| `done` | Approved and complete | terminal; auto-unblocks dependents |
| `failed` | Agent or environment error | `assigned` (retry) |

The `paused` state (#230) is a future addition for tasks that release their environment while preserving the ability to resume on the same or compatible environment (environment affinity / warm environments, #229).

### 3.4 Personas as Program Images

A **persona** is the `exec()` image for a session — it defines what the agent is and what it can do:

- **System prompt** — identity, expertise, behavioral instructions
- **Tool configuration** — which MCP tools are available (persona-scoped, #424)
- **Runtime configuration** — which agent SDK to use (Claude Code, Copilot, Codex)
- **Resource hints** — suggested environment type, token budget, concurrency class

Personas are stored in the database, managed through the CLI/UI (#594), and selected by the orchestrator based on task context (#384). The long-term vision includes:

- **Recruiter persona** (#166) — creates new specialized personas at runtime when the roster doesn't fit
- **Style mimic** (#165) — learns from human decisions to reduce escalation frequency
- **Self-improvement** (#167) — analyzes past execution to tune prompts and tool configs

See [2026-03-13-default-personas.md](2026-03-13-default-personas.md) for the initial roster.

### 3.5 Decomposition

A parent task decomposes work into child tasks. The parent sets dependencies between children (it has the bird's-eye view) and decides whether each child can further decompose (**decomposition rights**). This prevents pathological nesting.

Key principles from prior art (Claude Agent Teams, OpenAI Symphony):

- **Context-centric decomposition beats role-centric decomposition.** The agent implementing a feature should also write its tests, rather than handing to a separate "tester" persona. Dividing by context boundaries is more token-efficient than dividing by role.
- **Decomposition has overhead.** Multi-agent approaches consume 3–10x more tokens than single-agent. The orchestrator needs effort-scaling guidance — a simple bug fix should not spawn 5 subtasks. (#163, #385)
- **Dry-run decomposition** (#386) lets you preview the task tree before spawning agents.

---

## 4. Scheduling & Dispatch

### 4.1 The Reconciliation Loop

A periodic tick (inspired by Kubernetes controllers and Symphony's poll-dispatch-reconcile pattern) runs every N seconds (#152, #203–#209):

1. **Stall detection** (#204) — identify tasks that haven't produced events within a timeout window
2. **State consistency** (#205) — verify in-progress tasks have live environments, waiting tasks have pending children, dependency chains are coherent
3. **Dispatch** (#158) — assign pending tasks to available environments, respecting concurrency limits (#383)

This prevents silent drift — a crashed environment, a missed event, or a stuck agent gets caught on the next tick rather than waiting for a human to notice.

Configuration and tuning (#207): tick interval, stall timeout, max concurrent dispatches, per-persona concurrency caps. Web UI status indicator (#208) and tests (#209).

### 4.2 Environment Scheduling

The scheduler (#471) answers: given N pending tasks and M available environments, which tasks run where?

- **Concurrency limits** (#383) — global max and per-persona caps (e.g., at most 2 architects running simultaneously)
- **Environment affinity** (#229) — a task that was paused should prefer to resume on the same environment (warm cache, existing worktree). Lease mechanism (#231) with expiry (#233).
- **Inherited environments** (#232) — a dependency edge can carry `inheritEnvironment: true`, meaning the downstream task runs in the same environment as its upstream dependency (useful for sequential work on the same branch)
- **Workspace hygiene** (#261) — reset environment state between task assignments (clean worktree, remove temp files)

### 4.3 Triggers

Triggers are entry points that create or resume tasks:

| Trigger | Example | Issue |
|---|---|---|
| Human | User creates a task in the UI/CLI | exists |
| Child completion | Child task finishes → parent resumed | #495 |
| Scheduled (cron) | Poll ADO/Linear/GitHub for new work items every 15 min | #154 |
| Webhook | GitHub push, Slack message, Teams notification, CI failure | #346, #246 |
| Human notification | Agent needs input → alert via webhook | #509 |

All triggers flow through the same system. A scheduled poll creates a task with the "ADO Watcher" persona, which checks for new items and creates root tasks for the orchestrator. The orchestrator decomposes those just like human-initiated work.

---

## 5. Signals & Process Control

The #468 epic covers the signal taxonomy. Signals are **not** a new primitive — they decompose into existing ones (exit status + state transitions + tree traversal). But naming them clarifies the design.

### 5.1 Signal Taxonomy

| Signal | OS Equivalent | Behavior | Issue |
|---|---|---|---|
| Graceful shutdown | SIGTERM | Ask agent to finish current tool call, save state, exit cleanly | #494 |
| Child completion | SIGCHLD | Notify parent that a child task reached terminal state (done/failed) | #495 |
| Cascade kill | SIGKILL to process group | Kill a task and all its descendants | #497 |
| Orphan adoption | init reparenting | When a parent task fails, adopt its children to a policy (cancel, reparent to grandparent, or continue headless) | #496 |

### 5.2 Structured Session Results (Exit Status)

When a session ends, it produces a structured result (#498) — not just "completed" or "failed" but a typed disposition:

- **success** — work done, ready for review
- **needs_input** — agent blocked on a question → escalation to parent
- **failed** — unrecoverable error with diagnostic info
- **budget_exceeded** — token limit hit
- **killed** — externally terminated

This replaces the current binary completed/failed with richer information that the parent task (or reconciliation loop) can act on programmatically.

### 5.3 Escalation

Escalation is not a separate primitive — it's a session exiting with `needs_input` disposition (#480 comment). The flow:

1. Child session completes with `needs_input` + structured question
2. SIGCHLD fires → parent task resumed
3. Parent examines the question, decides: answer it (create new child session with context), escalate further (exit with own `needs_input`), or restructure the work
4. Chain continues up the tree until resolved or reaches the human

The human sits at the top but is rarely reached. Higher-order agents (architects, senior engineers) resolve most escalations. Goal: human gets pinged every 5–10 minutes at most across dozens of concurrent workstreams.

---

## 6. Resource Management

### 6.1 Token Budgets (cgroups for Agents)

Per-task token budgets (#500) are the agent equivalent of cgroups — hard limits on resource consumption:

- Set at task creation (explicitly or inherited from persona defaults)
- Tracked via session token accounting (#499) — each session reports token usage
- Budget inherited down the tree: a parent's budget is the cap for itself + all descendants
- Enforcement: when budget is exhausted, session receives a graceful shutdown signal, not a hard kill
- Rollup: project-level dashboard shows total spend per task, persona, environment

### 6.2 Agent Heartbeat

Health monitoring (#387) for running sessions:

- Periodic heartbeat from PowerLine to server
- Stall detection: no events within timeout → mark unhealthy
- Dead session cleanup: if environment disconnects and can't be recovered, mark sessions failed

---

## 7. Inter-Process Communication

### 7.1 Findings as Shared Memory

The existing findings system is IPC — agents post structured observations that other agents can read. Today this works through:

1. Agent calls `post_finding` MCP tool
2. Runtime intercepts → event stream → server stores in SQLite + broadcasts
3. Other agents receive findings in their system context at spawn time

Future refinements:
- **Finding scoping** (#160) — task-level, project-level, and global findings
- **Knowledge graph** (#13) — eventually replace flat findings with a graph for richer querying
- **Split findings into IPC vs. knowledge** (#480 comment) — transient signals (IPC) vs. durable knowledge (shared memory / graph)

### 7.2 Pipes and Composition (Speculative)

Session output streaming into another session's input (#545), forming DAGs:

```
research_agent | summarize_agent | write_agent
```

A research session's output becomes the input context for a summarization session, whose output feeds a writing session. This enables composable workflows without the overhead of full task decomposition.

### 7.3 A2A Protocol as TCP/IP (Speculative)

Google's Agent-to-Agent protocol (#544) maps to the networking layer:

| Kernel Concept | A2A Equivalent |
|---|---|
| TCP/IP + sockets | A2A HTTP + JSON-RPC transport |
| DNS / service discovery | Agent Card registry (`/.well-known/agent.json`) |
| Ports / listeners | Agent skills |
| Connect/accept | Task submission + streaming response |

Three roles for Grackle:

1. **A2A Host/Router** — Grackle tasks expose Agent Cards, server routes A2A messages between tasks or to external agents
2. **Agent Discovery** — local DNS-like registry for available agents
3. **A2A Server** — Grackle itself exposes an Agent Card so external systems can send work to it

**Phased approach:** Phase 1 = A2A client in tasks (discover/call external agents). Phase 2 = A2A routing between tasks (internal task-to-task). Phase 3 = Grackle as A2A server.

### 7.4 Typed Signals

Beyond findings and pipes, the system needs lightweight typed signals between tasks (#480 comment):

| Signal Type | Example | Direction |
|---|---|---|
| Notification | "I found a relevant pattern" | Child → parent |
| Control | "Pause and wait for further instructions" | Parent → child |
| Input | "Here's the answer to your question" | Parent → child |
| Request | "I need clarification on X" | Child → parent (escalation) |

---

## 8. Syscall Interface (MCP Broker)

The MCP broker (#420) is Grackle's syscall layer — the controlled interface through which agents access capabilities. Instead of agents having unrestricted tool access, the broker mediates:

- **Persona-scoped tool exposure** (#424) — each persona definition specifies which tools are available. A "researcher" persona gets read-only tools; an "engineer" gets edit/write/bash. The broker enforces this at runtime.
- **Orchestrator tools** (#343) — `list_tasks`, `get_task`, `start_task`, `create_task`, `approve_task`, `reject_task`, `get_task_events`. These are syscalls for process management — only granted to personas with orchestration rights.
- **Finding tools** — `post_finding`, `query_findings`. IPC syscalls.
- **Future: resource tools** — request more budget, request environment, fork task

The MCP server already auto-injects into agent sessions. The broker evolution is about making tool access declarative (in the persona definition) and enforceable (rejected at the broker, not just omitted from the prompt).

---

## 9. Hardware Abstraction Layer

### 9.1 PowerLine (HAL)

PowerLine runs inside each compute environment and abstracts the hardware. It exposes 10 gRPC RPCs (Spawn, Resume, SendInput, Kill, ListSessions, GetInfo, Ping, PushTokens, CleanupWorktree, GetDiff) and delegates to pluggable agent runtimes.

The kernel doesn't care what hardware (environment) a process (session) runs on — the adapter handles that.

### 9.2 Adapters (Device Drivers)

Four adapters exist today: Docker, SSH, Codespace, Local. Each implements `provision`, `connect`, `disconnect`, `stop`, `destroy`, `healthCheck`. Adding a new environment type = implementing one adapter.

### 9.3 File Descriptors as Resource Handles (Speculative)

The #545 proposal introduces typed file descriptors as a uniform resource abstraction:

| fd | Resource | Example |
|---|---|---|
| 0 | stdin | User/parent input |
| 1 | stdout | Event stream |
| 2 | stderr | Error stream |
| 3+ | Environment | Docker container, SSH host |
| 3+ | Widget | UI render target (#542) |
| 3+ | A2A connection | External agent handle (#544) |
| 3+ | Artifact | File/document produced by the task |

Uniform API: `open()`, `read()`, `write()`, `close()`. Handles are passable between sessions. Clean lifecycle — when a session dies, its open handles are closed (environments released, widgets torn down).

---

## 10. Prior Art

Research from #480 (comment 2) surveyed existing systems. Highest-priority borrowings:

| System | What to Borrow | What to Avoid |
|---|---|---|
| **Orleans** (virtual actors) | Virtual actor model for environment lifecycle — environments as logical entities, runtime handles activation/deactivation transparently | Actor discovery complexity |
| **Erlang/OTP** (supervision trees) | Supervision tree patterns for fault tolerance — restart strategies (one-for-one, one-for-all, rest-for-one) map to task failure policies | Full-mesh clustering, unbounded mailboxes |
| **Temporal** (durable execution) | Durable execution model for long-running tasks — survive process crashes, replay from event history | Determinism constraints (agents are inherently non-deterministic) |
| **Plan 9** (per-process namespaces) | Composable resource namespaces — each task sees a custom "filesystem" of available tools, credentials, and context | Radical departure from POSIX compatibility |
| **Mach** (capabilities) | Capability-based access tokens — delegatable, revocable, fine-grained permissions for tool access | Kernel complexity |
| **Kubernetes** (controllers) | Reconciliation loop — desired state vs. actual state, converge periodically | Operational complexity, YAML |
| **Ray** (resource scheduling) | Resource-aware scheduling — match task resource requirements to available environments | Cluster management overhead |

Also considered: Symphony (validated parallel task running, limited by no inter-agent coordination), Claude Agent Teams (validated context-centric decomposition, limited to single machine).

---

## 11. Phased Roadmap

### Phase 1: Task Lifecycle Foundation (Near-term)

Complete the core task state machine and orchestration primitives.

| Issue | What | Priority |
|---|---|---|
| #150 | Task `waiting` state — park parent while children execute | High |
| #191 | Proto — add WAITING to TaskStatus enum | High |
| #192 | Server — waiting state transitions and session suspension | High |
| #498 | Structured session result (exit status) | High |
| #495 | Child completion notification (SIGCHLD) | High |
| #494 | Graceful shutdown signal (SIGTERM) | High |
| #497 | Cascade kill (process group termination) | Medium |
| #496 | Orphan task policy | Medium |
| #431 | Bug: agent-created subtask dependency ordering | High |
| #430 | Bug: Copilot tasks don't self-complete | High |
| #162 | Artifacts and handoff between parent/child | Medium |
| #161 | Conversation history management / windowing | Medium |
| #156 | Hierarchical context scoping | Medium |

### Phase 2: Scheduling & Automation (Medium-term)

Automatic task dispatch, environment management, and external triggers.

| Issue | What | Priority |
|---|---|---|
| #152, #203 | Reconciliation loop core | High |
| #204, #205 | Stall detection + state consistency | High |
| #207, #208, #209 | Reconciliation config, UI, tests | Medium |
| #158 | Environment scheduling and dispatch | High |
| #383 | Concurrency limit enforcement | High |
| #471 | Epic: Environment Scheduling | High |
| #229, #231, #232, #233 | Environment affinity, leases, inheritance | Medium |
| #230 | Paused task state with environment hint | Medium |
| #499, #500 | Token accounting and per-task budgets | Medium |
| #154 | Scheduled triggers (cron) | Medium |
| #346 | External trigger ingestion (webhooks) | Medium |
| #509 | Human notification webhook | Medium |
| #246 | CI failure auto-trigger | Low |
| #261 | Workspace hygiene between assignments | Medium |

### Phase 3: Agent Intelligence (Medium-term)

Make the orchestrator smarter and personas more capable.

| Issue | What | Priority |
|---|---|---|
| #381 | Orchestrator system prompt template | High |
| #343 | MCP tools for orchestrator agents | High |
| #420 | MCP broker — unified syscall interface | High |
| #424 | Persona-scoped tool exposure | High |
| #384 | Persona auto-selection based on task context | Medium |
| #344 | Long-lived event-driven orchestrator sessions | Medium |
| #386 | Swarm dry-run — preview decomposition | Medium |
| #385 | Decomposition budget controls | Medium |
| #163 | Decomposition heuristics | Medium |
| #387 | Agent heartbeat and health monitoring | Medium |
| #466 | Epic: Agent Intelligence | — |

### Phase 4: Advanced IPC & Networking (Longer-term)

Deepen the kernel model with richer inter-agent communication.

| Issue | What | Priority |
|---|---|---|
| #545 | Process model — threads, IPC, file descriptors | Speculative |
| #544 | A2A protocol for inter-agent networking | Speculative |
| #542 | Widget compositor for task UI output | Speculative |
| #164 | Cross-branch task dependencies | Medium |
| #160 | Finding scoping (task-level, global) | Medium |
| #13 | Knowledge graph to replace findings | Speculative |

### Phase 5: Autonomy & Self-Improvement (Long-term)

Features that increase agent autonomy and reduce human involvement.

| Issue | What | Priority |
|---|---|---|
| #166 | Recruiter persona — dynamic persona creation | Speculative |
| #165 | Style mimic — learn human decision patterns | Speculative |
| #167 | Self-improvement loop | Speculative |
| #28, #29 | New runtimes (Crush, Goose) | Speculative |

---

## 12. UX Touchpoints

Several backlog issues are UX implementations of kernel concepts:

| Issue | What |
|---|---|
| #593 | Unify create/edit task UX |
| #594 | Unify create/edit persona UX |
| #297 | Dependency management during task creation |
| #284 | Task & project workflow UX |
| #245 | Review queue — batch approval UX |
| #159 | Task tree visualization in web UI |
| #437 | Toast notifications on task state changes |
| #447 | Task search (fuzzy search for CLI and MCP) |

See [2026-03-12-ux-audit.md](2026-03-12-ux-audit.md) for the full UX improvement backlog.

---

## 13. Open Questions

1. **Session–environment decoupling granularity.** How lightweight can an environment-less session be? Does it still go through PowerLine, or does the server run it directly? (#545)

2. **Conversation history for long-running orchestrators.** A parent task resumed 50 times has enormous context. Window it? Summarize it? Or is the structured project state (tasks + findings) sufficient, making full history unnecessary? (#161)

3. **Cross-branch dependencies.** Today, dependencies exist between siblings (set by parent). Are there real cases where a task in one branch needs to wait for a task in a different branch? How is that expressed without sideways communication? (#164)

4. **Persona versioning.** Personas evolve as the team learns what works. How are they versioned? Can you roll back a persona change? Do different projects use different persona snapshots?

5. **Multi-tenancy.** Multiple humans overseeing different projects on the same Grackle instance. What's the isolation model? Shared personas, separate task trees? RBAC?

6. **A2A trust model.** When Grackle tasks communicate via A2A, how does auth work? Can an external agent submit work to Grackle without human approval? (#544)

7. **Token budget inheritance.** If a parent has a 100K token budget and spawns 5 children, is it split evenly? Does the parent reserve a portion for its own resumptions? What happens when a child exceeds its share? (#500)

8. **Determinism vs. creativity in decomposition.** The same task given to the same orchestrator persona may produce different decompositions each time. Is that acceptable? Should decomposition be reproducible (seeded) or is variability a feature? (#163)
