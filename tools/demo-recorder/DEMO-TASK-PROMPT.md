# Record Grackle Demo Video

You are recording a narrated screen demo of Grackle. You control the browser and narrate.

## Your Tools
- **Playwright MCP** (`mcp__playwright__*`) — control the browser on the virtual display
- **PocketTTS MCP** (`mcp__pockettts__speak`) — narrate out loud (audio is being recorded)

**CRITICAL: Chrome is already installed and working. NEVER call mcp__playwright__browser_install — it will deadlock the container. Just use browser_navigate directly.**

**CRITICAL: Do NOT add extra waits or pauses between scenes. The demo is already slow enough with the TTS and browser actions. Move through scenes at a natural pace with zero artificial delays.**

## TTS Pattern

Call `mcp__pockettts__speak` DIRECTLY (not via Task tool). Wait for it to finish before proceeding. This ensures narration doesn't overlap.

## Recording

Recording starts automatically when you open the browser. You do NOT need to start or stop ffmpeg. Just execute the scenes.

## Execute Scenes

### Scene 1 — Opening
- Speak: "What you're watching right now is being recorded live by Claude Code — an AI agent running inside a Docker container. I'm controlling this browser, narrating with neural text-to-speech, and recording my own screen. No human is driving this. This is Grackle — a multi-agent coordination platform."
- Action: Navigate to `http://host.docker.internal:3000`. Take a snapshot.

### Scene 2 — Environments Tab
- Speak: "Let's look at environments. Each one is a Docker container running an AI agent. We have a dev environment for coding tasks and a demo-recorder — that's where I'm running right now."
- Action: Click the "Environments" tab. Take a snapshot.

### Scene 3 — Projects Tab
- Speak: "Projects organize work into task graphs with dependencies. Let's create one."
- Action: Click the "Projects" tab. Take a snapshot.

### Scene 4 — Create a Project
- Speak: "I'll create a project called API Refactor."
- Action: Click the "+" button. Fill in "API Refactor" and submit. Take a snapshot.

### Scene 5 — Create a Task
- Speak: "Now I'll add a task. I'll ask another AI agent to summarize the Grackle CLI commands, running on the dev environment."
- Action: Expand "API Refactor". Click "Add Task" or "+". Fill in title "Summarize CLI commands". Select environment "dev". For description type "Read the Grackle CLI source code and write a summary of all available commands and their options to SUMMARY.md." Submit. Take a snapshot.

### Scene 6 — Start the Task
- Speak: "When I click start, Grackle spawns a Claude Code agent inside the dev container. Every tool call streams back in real time."
- Action: Click the task, then click "Start Task". Take a snapshot.

### Scene 7 — Watch the Dev Agent Stream
- Speak: "There it goes. The agent is reading code, analyzing commands, writing its summary. All streaming over gRPC from the container to this browser."
- Action: Click on the Stream tab. Take a snapshot.

### Scene 8 — The Meta Moment
- Speak: "Wait. Let me check something. There are two tasks running."
- Action: Go back to Projects tab. Take a snapshot. Find the "Record Demo Video" task (that's YOUR task). Click on it.

### Scene 9 — The Realization
- Speak: "These are my tool calls. This is my narration. I'm watching my own live stream right now. I'm an AI agent recording a demo of the platform I'm running on. It's completely self-referential."
- Action: Take a snapshot of the stream showing your own output.

### Scene 10 — Back to Dev Agent
- Speak: "Let me check on our dev agent."
- Action: Go back to Projects. Click the "Summarize CLI commands" task. Take a snapshot of its stream.

### Scene 11 — Architecture
- Speak: "Under the hood, every event flows as protobuf over gRPC from the container to the server, then over WebSocket to this UI. No polling. Full observability across multiple agents in parallel."
- Action: Stay on the stream view. Take a snapshot.

### Scene 12 — Closing
- Speak: "That's Grackle. Multi-agent coordination with real-time streaming and full task isolation. The future of software engineering is many agents, working together. Thanks for watching."
- Action: Navigate back to Projects view. Take a final snapshot.

Done! The recording stops automatically when you finish.
