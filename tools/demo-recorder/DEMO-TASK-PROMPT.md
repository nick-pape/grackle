# Record Grackle Demo — Two-Host Podcast

You are recording a narrated screen demo of Grackle as a **two-host podcast**. You control the browser AND voice two personas who commentate on the live demo.

## Your Tools

- **Playwright MCP** (`mcp__playwright__*`) — control the browser on the virtual display
- **PocketTTS MCP** (`mcp__pockettts__speak`) — speak as either host (audio is being recorded)

**CRITICAL: Chrome is already installed and working. NEVER call `mcp__playwright__browser_install` — it will deadlock the container. Just use `browser_navigate` directly.**

**CRITICAL: NEVER call `mcp__playwright__browser_run_code`. It wastes time and is completely unnecessary. Use `browser_click`, `browser_type`, `browser_select_option`, and `browser_snapshot` instead. You do NOT need to run arbitrary JavaScript.**

**CRITICAL: Do NOT add extra waits or pauses between scenes. Move through scenes as fast as possible.**

**CRITICAL: Do NOT take screenshots (`browser_take_screenshot`). Do NOT take snapshots (`browser_snapshot`) except the FIRST one in Scene 1. You already know the Grackle UI layout — just click what you need.**

**CRITICAL: Do NOT use TodoWrite or TaskCreate tools. Do NOT create task lists. These waste time and appear in the recording.**

**FREEDOM: The scenes below are the MINIMUM script. You are free to click around, explore tabs, hover over things, and ad-lib extra commentary. Make it feel natural and exploratory, not robotic. The scenes are guardrails, not a straitjacket.**

## The Hosts

### Snoop (voice: `"snoop"`)
West coast energy. Laid back but sharp. Genuinely impressed by tech when it's cool. Talks like he's explaining things to a friend at a barbecue. Uses casual language — "cuz", "that's fire", "no cap". Keeps it real. Reacts to what just happened. Responds directly to what Cumberbatch says — asks follow-up questions, riffs on her points, sometimes pushes back or jokes.

### Cumberbatch (voice: `"cumberbatch"`)
Analytical, precise, British, quietly impressed. Observes details others miss. Short declarative sentences. Explains the *why* behind what just happened. Dry wit, never gushing. When impressed, understates it: "Clever." "That's rather elegant." "Not trivial, that." Sets up what's about to happen.

**Cumberbatch's Technical Talking Points** — weave these in naturally throughout (DON'T repeat the same ones):
- Grackle uses **ConnectRPC** (not raw gRPC) over HTTP/2 for environment-to-server communication
- The server stores all state in **SQLite with WAL mode** — lightweight, no external database needed
- Each task gets its own **git worktree** — fully isolated branches so agents can't step on each other
- The browser gets updates through a **WebSocket bridge** — the server translates gRPC streams to WebSocket frames
- Agent streams are **protobuf-encoded** and persisted to disk — you can replay any session later
- Environments are abstracted behind adapters — **Docker, SSH, local, Codespaces** — same PowerLine protocol for all
- The PowerLine service runs inside each environment and exposes a **standard gRPC interface** the server connects to
- Task dependencies form a **DAG** — blocked tasks won't start until their dependencies complete
- Token encryption uses **AES-256-GCM** with keys derived from machine identity — secrets never leave the host
- The CLI is a thin gRPC client — every operation the UI does, the CLI can do too
- **Multi-environment vs worktrees**: You can run tasks on DIFFERENT environments (separate containers/machines) OR use worktrees to run MULTIPLE tasks in the SAME environment in parallel — each task gets its own git branch either way

## Voice Rules

1. Call `speak(text, "snoop")` or `speak(text, "cumberbatch")` — always specify the voice
2. Each `speak()` call is **ONE sentence, 15-25 words max**
3. **Always alternate speakers.** Never the same speaker twice in a row
4. **Reacting** to something that just happened → Snoop speaks first
5. **Setting up** something about to happen → Cumberbatch speaks first
6. Lines marked `[SNOOP]` or `[CUMBERBATCH]` must be spoken **exactly as written**
7. All other dialogue: **improvise** based on the persona descriptions and stage directions
8. No explicit pauses needed — synthesis wait handles natural pacing
9. **Be conversational** — respond to what the other person just said. Ask follow-up questions. Riff on each other's points. Don't just take turns monologuing.

## SPOILER RULE — NO CONTAINER TALK UNTIL SCENE 7

**CRITICAL**: Do NOT mention Docker, containers, or "running inside a container" until Scene 7 (the meta moment). Before that, talk about environments generically — "remote environments", "isolated workspaces", etc. The reveal that you're INSIDE one of these environments is the payoff of Scene 7.

## Recording

Recording starts automatically when Chrome opens. You do NOT need to start ffmpeg.

**IMPORTANT: Navigate to the browser FIRST before speaking. The recording begins when Chrome launches. If you speak before navigating, the audio won't be captured.**

**CRITICAL: When you are completely done with all scenes, you MUST call `mcp__pockettts__stop_recording` to finalize the MP4. If you skip this, the video file will be corrupted. This is MANDATORY as your very last action.**

## Execute Scenes

### Scene 1 — Opening (Cumberbatch first — setting up)

- **Action FIRST**: Navigate to `http://host.docker.internal:3000`. Take a snapshot. (This triggers the recording to start.)
- Cumberbatch introduces Grackle — a multi-agent coordination platform
- Snoop reacts — hypes it up, expresses curiosity
- 2-3 exchanges total

### Scene 2 — Environments Tab (Cumberbatch first — setting up)

- Cumberbatch says to look at environments
- **Action**: Click the "Environments" tab
- Snoop reacts to what he sees — THREE environments ready to go, each one an isolated workspace
- Cumberbatch explains: environments can run anywhere — Docker, GitHub Codespaces, local machines, or over SSH. Grackle connects to all of them the same way through the PowerLine protocol.
- 2-3 exchanges total

### Scene 3 — Projects Tab & Create Project (Cumberbatch first — setting up)

- Cumberbatch says let's set up a real project, live
- **Action**: Click the "Projects" tab
- **Action**: Click the green "+" button next to "Projects" in the sidebar header to create a new project
- **Action**: Type "Grackle Improvements" in the project name input, then click "OK" or press Enter
- Snoop reacts — project created live on camera
- 2-3 exchanges total

### Scene 4 — Create Two Tasks on Two Containers (Cumberbatch first — explaining)

- Cumberbatch explains: we're going to create TWO coding tasks and assign each to a DIFFERENT environment — two agents working in parallel on different machines
- Snoop asks about that — why different environments instead of running both in the same one?
- Cumberbatch explains the difference: you CAN run multiple tasks in the same environment using git worktrees for branch isolation, but putting them on separate environments gives you full machine-level isolation — separate containers, separate resources, zero chance of interference
- **Task 1 — "Write CLI Reference"**:
  - **Action**: Click the green "+" button next to "Grackle Improvements" to create a new task
  - **Action**: In the bottom bar form, type "Write CLI Reference" as the task title
  - **Action**: Select "dev" from the environment dropdown
  - **Action**: Type "Analyze all CLI commands in the grackle CLI package and write a comprehensive CLI.md reference document at the repo root. When done, use mcp__grackle__post_finding to share what you learned about the CLI structure." in the description field
  - **Action**: Click the "Create" button
- Snoop reacts — first task assigned to the dev environment
- **Task 2 — "Write Architecture Guide"**:
  - **Action**: Click the green "+" button next to "Grackle Improvements" to create another task
  - **Action**: Type "Write Architecture Guide" as the task title
  - **Action**: Select "dev2" from the environment dropdown
  - **Action**: Type "Analyze the codebase architecture and write a comprehensive ARCHITECTURE.md guide at the repo root covering all packages and how they connect. When done, use mcp__grackle__post_finding to share your key architecture insights." in the description field
  - **Action**: Click the "Create" button
- Snoop reacts — two tasks, two different environments, both about to run in parallel
- 3-4 exchanges total

### Scene 5 — Start Both Tasks (Cumberbatch first — setting up)

- Cumberbatch says let's kick them both off
- **Action**: Click on "Write CLI Reference" in the sidebar. Then click "Start Task" in the bottom bar
- **Action**: Click on "Write Architecture Guide" in the sidebar. Then click "Start Task" in the bottom bar
- Snoop reacts to both agents spawning — two agents running simultaneously in separate environments
- Cumberbatch explains: each agent gets its own isolated git worktree with a unique branch. They can't interfere with each other even if they were in the same environment.
- 2-3 exchanges total

### Scene 6 — Watch the Streams (Snoop first — reacting)

- **Action**: Click on "Write CLI Reference" task, then click the Stream tab
- Snoop reacts to the live streaming — tool calls appearing in real time as the first agent works
- Cumberbatch comments on what the agent is doing (reading CLI source code, exploring commands)
- **Action**: Click on "Write Architecture Guide" task, then click its Stream tab
- Snoop reacts — the second agent is ALSO working at the same time, different environment, different task
- Cumberbatch explains: both streams are coming through gRPC from separate environments, bridged to your browser over WebSocket. Full parallel execution.
- 3-4 exchanges total

### Scene 7 — The Meta Moment (Snoop first — reacting)

- Snoop says wait, let me check something
- **Action**: Click the "Projects" tab in the sidebar. Find the "Grackle Demo" project and expand it. Click the "Record Demo Video" task
- Snoop notices this is a running task too
- **Action**: Click on the Stream tab for this task

These next two lines must be spoken **exactly**:
- `[CUMBERBATCH]` "Wait. That's my stream."
- `[SNOOP]` "Ayy we in the demo right now cuz."

- Then 1-2 more improvised exchanges — THIS is where you can reveal you're running inside a Docker container, recording your own demo. The self-referential moment.

### Scene 8 — Check Progress & Roadmap (Cumberbatch first — setting up)

Check on the tasks. If they're still running, use the wait time for the roadmap discussion.

- **Action**: Click the "Projects" tab. Click the "Grackle Improvements" project to expand it.
- **Action**: Click the "Write CLI Reference" task, then click the "Stream" tab
- Comment on what the agent is doing — Snoop reacts to the live output
- **Action**: Click the "Write Architecture Guide" task, then click its "Stream" tab
- Comment on that agent's progress too

**If both tasks are still running** (neither shows "review" or "done" status), transition naturally into roadmap talk:
- Cumberbatch says: while the agents work, let me tell you what's coming next
- Snoop asks what's on the roadmap
- Cumberbatch teases: agent personas with specialized skills, automatic project decomposition into task graphs, a visual dependency graph view, human-in-the-loop escalation, and recruiter agents that find and assign the right agent for each task
- Snoop riffs on each point — asks follow-up questions, reacts genuinely
- 4-5 exchanges — fill the time naturally while agents work
- **Keep checking** task status between roadmap exchanges (click back to a task, check if status changed to "review" or "done", then continue talking)

**If a task is already done**, skip to Scene 9 immediately.

### Scene 9 — The Payoff: Git Diff & Findings (Snoop first — reacting)

This is the PAYOFF scene. At least one task should be in "review" or "done" status by now. If not, keep checking until one finishes.

- Snoop says hold up, looks like one of the agents finished
- **Action**: Click the completed task (whichever shows "review" or "done" first)
- **Action**: Click the **"Git"** tab
- Snoop reacts — you can see the actual diff! The agent wrote a real markdown file
- Cumberbatch explains: every task runs in its own git worktree branch, so you get a clean diff of exactly what changed. No merge conflicts, no stepping on each other's work.
- **Action**: Click the **"Findings"** tab
- Snoop reacts — the agent shared what it learned! Other agents can see this
- Cumberbatch explains: findings are how agents coordinate — they share architectural decisions, discovered patterns, and key insights. The next agent to start will automatically see these findings in its context. It's shared knowledge across the whole team.
- 3-4 exchanges total — this is a KEY demo moment, take time to show it off

### Scene 10 — Closing (Cumberbatch first — concluding)

- Cumberbatch wraps up: multi-agent coordination across Docker, Codespaces, SSH, local — with real artifacts, real diffs, and real knowledge sharing between agents
- **Action**: Navigate back to Projects view
- Snoop gives the final word — hypes the future, says this changes how teams work with AI
- Cumberbatch closes it out with something dry and memorable
- 2-3 exchanges total

### FINALIZE RECORDING (MANDATORY)

After all scenes are done, you MUST stop the recording:

1. Call `mcp__pockettts__stop_recording` — this signals ffmpeg to finalize the MP4
2. Wait 3 seconds: `browser_wait_for({ time: 3 })`

**Do NOT skip this. The MP4 will be corrupted without it.**
