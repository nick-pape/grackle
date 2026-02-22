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

### Scene 1 — Opening
- Action FIRST: Navigate to `http://host.docker.internal:3000`. Take a snapshot. (This triggers the recording to start.)
- Speak AFTER navigation (one sentence per call):
  - "What you're watching right now is being recorded live by Claude Code."
  - "An AI agent running inside a Docker container."
  - "I'm controlling this browser, narrating with neural text-to-speech, and recording my own screen."
  - "No human is driving this."
  - "This is Grackle, a multi-agent coordination platform."

### Scene 2 — Environments Tab
- Speak: "Let's look at environments."
- Action: Click the "Environments" tab.
- Speak: "Each one is a Docker container running an AI agent."
- Speak: "We have a dev environment for coding tasks, and a demo-recorder. That's where I'm running right now."

### Scene 3 — Projects Tab
- Speak: "Projects organize work into task graphs with dependencies."
- Action: Click the "Projects" tab.
- Speak: "There's already a project set up called Grackle Improvements."

### Scene 4 — Expand the Project
- Speak: "It has two tasks."
- Action: Click on "Grackle Improvements" to expand it.
- Speak: "One is a dev task to summarize the CLI commands."
- Speak: "The other is this recording session itself."

### Scene 5 — Start the Dev Task
- Speak: "Let's kick off the dev task."
- Action: Click on "Summarize CLI commands". Then click "Start Task".
- Speak: "Grackle just spawned a Claude Code agent inside the dev container."
- Speak: "Every tool call streams back in real time."

### Scene 6 — Watch the Dev Agent Stream
- Speak: "There it goes."
- Action: Click on the Stream tab for the dev task.
- Speak: "The agent is reading code, analyzing commands, writing its summary."
- Speak: "All streaming over gRPC from the container to this browser."

### Scene 7 — The Meta Moment
- Speak: "Wait. Let me check something."
- Action: Go back to Projects tab. Find the "Record Demo Video" task (that's YOUR task). Click on it.
- Speak: "There are two tasks running right now."

### Scene 8 — The Realization
- Speak: "These are my tool calls."
- Speak: "This is my narration."
- Speak: "I'm watching my own live stream right now."
- Speak: "I'm an AI agent recording a demo of the platform I'm running on."
- Speak: "It's completely self-referential."

### Scene 9 — Back to Dev Agent
- Speak: "Let me check on our dev agent."
- Action: Go back to Projects. Click the "Summarize CLI commands" task.

### Scene 10 — Architecture
- Speak: "Under the hood, every event flows as protobuf over gRPC from the container to the server."
- Speak: "Then over WebSocket to this UI."
- Speak: "No polling. Full observability across multiple agents in parallel."

### Scene 11 — Closing
- Speak: "That's Grackle."
- Speak: "Multi-agent coordination with real-time streaming and full task isolation."
- Action: Navigate back to Projects view.
- Speak: "The future of software engineering is many agents, working together."
- Speak: "Thanks for watching."

Done! The recording stops automatically when you finish.
