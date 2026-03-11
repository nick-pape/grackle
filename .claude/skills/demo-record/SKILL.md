---
name: demo-record
description: Launch the self-recording Grackle demo. Builds Docker images, cleans state, provisions environments, creates project/task, and starts the demo recording agent.
disable-model-invocation: true
---

# Launch Grackle Demo Recording

This skill sets up and launches the self-recording Grackle demo where a Claude Code agent inside Docker controls a browser with Playwright MCP, narrates with PocketTTS MCP, and records its own screen with ffmpeg.

## Prerequisites

- Grackle server must be running (`node packages/server/dist/index.js` or `grackle serve`)
- Docker Desktop must be running
- `ANTHROPIC_API_KEY` must be set (or `~/.claude/.credentials.json` mounted)

## Steps

### 1. Build all packages

```bash
rush build
```

### 2. Build Docker images

```bash
# Demo recorder image (Playwright + Xvfb + PulseAudio + ffmpeg + PocketTTS)
# No --secret needed: uses PocketTTS built-in voices (no HF_TOKEN required)
docker build -f Dockerfile.demo-recorder -t grackle-demo-recorder .

# Dev environment image (standard PowerLine)
docker build -f Dockerfile.powerline -t grackle-powerline .
```

### 3. Nuke database and restart server

The demo must start with a completely clean database — no leftover projects, tasks, or findings from previous runs. Stale data causes the demo agent to see pre-existing tasks instead of creating them fresh on camera.

```bash
# Kill the grackle server (it holds the DB lock)
# Windows (Git Bash): find PID with `wmic process where "name='node.exe'" get processid,commandline | grep server`
# then: taskkill /PID <SERVER_PID> /F
# Linux/Mac: kill $(pgrep -f "node.*server/dist/index.js")

# Delete the database
rm -f ~/.grackle/grackle.db ~/.grackle/grackle.db-wal ~/.grackle/grackle.db-shm

# Restart the server
node packages/server/dist/index.js --port=7434 --web-port=3000 &
```

Also stop and remove any existing containers:

```bash
docker stop grackle-demo-recorder grackle-dev grackle-dev2 2>/dev/null
docker rm grackle-demo-recorder grackle-dev grackle-dev2 2>/dev/null
```

### 4. Add and provision environments

Since the DB was nuked, environments must be re-added and provisioned:

```bash
# Demo recorder with the full AV stack
grackle env add demo-recorder --docker --image grackle-demo-recorder --runtime claude-code

# Dev environments with repo clone (the demo agent creates tasks on these live)
grackle env add dev --docker --image grackle-powerline --runtime claude-code --repo nick-pape/grackle
grackle env add dev2 --docker --image grackle-powerline --runtime claude-code --repo nick-pape/grackle

# Provision all three
grackle env provision demo-recorder
grackle env provision dev
grackle env provision dev2
```

Verify all three show "connected":

```bash
grackle env list
```

### 5. Create project and recording task

The demo agent creates its own project and dev tasks live on camera (Scenes 3-4). Only pre-create the "Grackle Demo" project and the recording task.

```bash
grackle project create "Grackle Demo"
# Note the project ID from output
```

Create the demo recording task using the scene script:

```bash
DEMO_DESC=$(cat tools/demo-recorder/DEMO-TASK-PROMPT.md)
grackle task create <PROJECT_ID> "Record Demo Video" --env demo-recorder --desc "$DEMO_DESC"
```

### 6. Start the recording task

```bash
grackle task start <RECORDING_TASK_ID> --model haiku
```

**Important**: Use `--model haiku` to keep the demo fast and cheap.

### 7. Monitor and extract

After starting the task, monitor the session and automatically extract the video when it completes.

Poll the task status until it leaves `in_progress`. Then copy the MP4 out:

```bash
# Poll task status every 30s until done
grackle task list <PROJECT_ID>
# When task status is "review" or "done":
docker cp grackle-demo-recorder:/workspace/grackle-demo.mp4 ./grackle-demo-podcast-vN.mp4
```

Also check ffmpeg recording status if needed:

```bash
docker exec grackle-demo-recorder bash -c "ls -lh /workspace/grackle-demo.mp4 2>&1"
```

## Troubleshooting

- **Chrome deadlock**: Never call `mcp__playwright__browser_install` — Chrome is pre-installed
- **No video**: Check `docker exec grackle-demo-recorder bash -c "cat /tmp/ffmpeg.log"`
- **Windows line endings**: If scripts fail with `/bin/bash\r`, run `sed -i 's/\r$//' tools/demo-recorder/*.sh`
- **Auth errors after container recreate**: Remove and re-provision containers (tokens are invalidated)
- **Dev agent model**: Always use `--model haiku` when starting tasks to avoid defaulting to expensive models
