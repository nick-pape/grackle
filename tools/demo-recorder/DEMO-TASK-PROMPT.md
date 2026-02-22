# Record Grackle Demo Video

You are recording a narrated screen demo of Grackle. You have three MCP tools available alongside standard tools:
- **Playwright MCP** (`mcp__playwright__*`) — control the browser (headed Chromium on the virtual display)
- **PocketTTS MCP** (`mcp__pockettts__speak`) — narrate out loud (audio captured by ffmpeg)
- **Bash** — run shell commands

IMPORTANT: ffmpeg is ALREADY recording the screen and audio in the background (started by the entrypoint). The PID is in /tmp/ffmpeg.pid. You do NOT need to start it. Just do your scenes and stop it at the end.

## Step 1: Navigate to Grackle

Use Playwright MCP to navigate to `http://host.docker.internal:3000`.
Use `mcp__playwright__browser_snapshot` to verify the page loaded.

## Step 2: Execute Scenes

For each scene below, first speak the narration using `mcp__pockettts__speak`, then perform the browser action, then wait the specified time using `mcp__playwright__browser_wait_for` with the `time` parameter.

### Scene 1 — Intro
- Speak: "This is Grackle — a multi-agent task pipeline that coordinates AI agents through projects, tasks, and real-time streaming."
- Action: Take a snapshot to see the main UI layout
- Wait: 3 seconds

### Scene 2 — Projects Tab
- Speak: "Projects organize work into tasks with dependencies. Let's create one."
- Action: Click the Projects tab in the sidebar
- Wait: 2 seconds

### Scene 3 — Create Project
- Speak: "We'll call this project 'API Refactor'."
- Action: Click the "+" button, fill in project name "API Refactor", submit
- Wait: 3 seconds

### Scene 4 — Create Task
- Speak: "Each task gets a title, an environment to run in, and a description for the AI agent."
- Action: Expand the project, click "Add Task", fill in title "Migrate REST endpoints", select an environment, add description
- Wait: 3 seconds

### Scene 5 — Start Task
- Speak: "When you start a task, PowerLine creates a git worktree for isolation and spawns a Claude Code agent."
- Action: Click "Start" on the task
- Wait: 5 seconds for streaming to begin

### Scene 6 — Watch Stream
- Speak: "Every tool call, every line of reasoning streams back in real time through gRPC and WebSocket."
- Action: Click on the Stream tab, watch output flow
- Wait: 8 seconds

### Scene 7 — Meta Moment
- Speak: "Wait... look at that stream. That's THIS recording session. The demo is recording itself."
- Action: Look in the sidebar for a task with status "in_progress" whose title contains "Record" or "demo". Click on it to see its stream tab. This is YOUR task — the one running right now.
- Wait: 5 seconds

### Scene 8 — Architecture
- Speak: "Every event flows as protobuf over gRPC from the container back to the server, then over WebSocket to this UI. No polling, no delays."
- Action: Stay on the stream view, let it scroll
- Wait: 5 seconds

### Scene 9 — Wrap Up
- Speak: "That's Grackle — from project to review in one pipeline. The future of software engineering is multi-agent coordination."
- Action: Navigate back to the Projects view
- Wait: 3 seconds

## Step 3: Stop Recording

```bash
kill $(cat /tmp/ffmpeg.pid)
sleep 2
ls -la /workspace/grackle-demo.mp4
```

The video is at `/workspace/grackle-demo.mp4`. Confirm it exists and report the file size.
