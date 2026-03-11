# Record Grackle Demo Video

You are recording a narrated screen demo of Grackle. You control the browser and narrate.

## Your Tools
- **Playwright MCP** (`mcp__playwright__*`) — control the browser on the virtual display
- **PocketTTS MCP** (`mcp__pockettts__speak`) — narrate out loud (audio is being recorded)

**CRITICAL: Chrome is already installed and working. NEVER call mcp__playwright__browser_install — it will deadlock the container. Just use browser_navigate directly.**

**CRITICAL: Do NOT add extra waits or pauses between scenes. Move through scenes as fast as possible.**

**CRITICAL: Do NOT take screenshots (`browser_take_screenshot`). Do NOT take snapshots (`browser_snapshot`) except the FIRST one in Scene 1. You already know the Grackle UI layout — just click what you need.**

## TTS Pattern

Call `mcp__pockettts__speak` for each SENTENCE separately. Shorter text = faster audio. The tool returns instantly (audio plays in background). You can immediately proceed with browser actions while narration plays. Do NOT wait after speaking — just keep going.

## Recording

Recording starts automatically when Chrome opens. You do NOT need to start or stop ffmpeg.

**IMPORTANT: Navigate to the browser FIRST before speaking. The recording begins when Chrome launches. If you speak before navigating, the audio won't be captured.**

## Execute Scenes

### Scene 1 — Opening + Hook
- Action FIRST: Navigate to `http://host.docker.internal:3000`. Take a snapshot. (This triggers the recording to start.)
- Speak AFTER navigation (one sentence per call):
  - "...This is Grackle, a multi-agent coordination platform."
  - "...What you're watching right now is being recorded live by an AI agent."
  - "...Let me show you what it can do."

### Scene 2 — Problem Statement
- Action: Click on the "Projects" tab in the sidebar. Click on "API Gateway Refactor" to expand it.
- Speak:
  - "...Modern software projects are too complex for a single AI agent."
  - "...Grackle lets you break work into a task graph with dependencies."
  - "...And assign each task to an isolated agent in its own container."

### Scene 3 — Task Tree
- Speak:
  - "...Here's our project. A tree of tasks with parent-child relationships."
  - "...Design API Schema is already done, shown with the green badge."
  - "...Its subtasks, define REST endpoints and define error contracts, are also complete."
  - "...The remaining tasks are blocked until their dependencies finish."

### Scene 4 — DAG Visualization
- Action: Click the "Graph" tab (DAG view for the project).
- Speak:
  - "...This is the dependency graph."
  - "...Each node is a task. Edges show what depends on what."
  - "...Done tasks are green. Pending tasks are gray."
  - "...You can see the diamond pattern. Rate limiter and auth middleware can run in parallel."
  - "...But integration tests won't start until both are done."

### Scene 5 — Start Dev Task
- Action: Go back to the task list. Click on "Implement rate limiter". Click "Start Task".
- Speak:
  - "...Let's kick off a real task."
  - "...Grackle spawns a Claude Code agent inside a Docker container."
  - "...It gets a worktree on a fresh branch with the task description as its prompt."

### Scene 6 — Live Stream
- Speak:
  - "...Every tool call streams back in real time."
  - "...The agent is reading code, planning its approach, writing files."
  - "...All flowing over gRPC from the container to this browser."
- Action: Wait a moment to let some events stream in visually.

### Scene 7 — Meta Moment
- Action: Navigate back to the project task list. Click on "Record Demo Video" (that's YOUR task).
- Speak:
  - "...Wait. Look at this."
  - "...This is my task. The one I'm running right now."
  - "...These are my tool calls. My narration. My browser clicks."
  - "...I'm watching my own live stream."

### Scene 8 — Blocked Task
- Action: Click on "Write integration tests" in the task list.
- Speak:
  - "...This task is blocked."
  - "...It depends on both the rate limiter and auth middleware."
  - "...Grackle tracks these dependencies automatically."
  - "...When both finish and pass review, this task unlocks."

### Scene 9 — Environments
- Action: Click the "Environments" tab in the sidebar.
- Speak:
  - "...Each agent runs in its own isolated environment."
  - "...Right now we have two Docker containers."
  - "...The dev container for coding tasks, and the demo recorder where I'm running."

### Scene 10 — Check Dev Progress
- Action: Navigate back to Projects. Click "API Gateway Refactor". Click on "Implement rate limiter".
- Speak:
  - "...Let's check on our dev agent."
  - "...It's been working while we've been talking."

### Scene 11 — Diff Viewer
- Action: Click the "Diff" tab for the rate limiter task.
- Speak:
  - "...The diff tab shows every change the agent has made."
  - "...When the agent finishes, the task moves to review."
  - "...A human or another agent can approve or reject with feedback."

### Scene 12 — Findings
- Action: Click the "Findings" tab.
- Speak:
  - "...Agents can share discoveries with each other through findings."
  - "...Architecture decisions, bugs found, API patterns."
  - "...This is how multiple agents build shared context across a project."

### Scene 13 — DAG + Closing
- Action: Click the "Graph" tab to show the DAG again.
- Speak:
  - "...That's Grackle."
  - "...Task graphs with real dependencies. Isolated containers. Live streaming."
  - "...Review gates so humans stay in control."
  - "...The future of software engineering is multiple agents, working together, coordinated."
  - "...Thanks for watching."

Done! The recording stops automatically when you finish.
