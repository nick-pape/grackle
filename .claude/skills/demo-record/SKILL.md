---
name: demo-record
description: Launch the self-recording Grackle demo. Builds Docker images, cleans DB, provisions environments, creates project/task, and starts the demo recording agent.
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
docker build -f Dockerfile.demo-recorder -t grackle-demo-recorder .

# Dev environment image (standard PowerLine)
docker build -f Dockerfile.powerline -t grackle-powerline .
```

### 3. Clean database

Remove old projects, tasks, and findings so the demo starts clean:

```javascript
// Run from packages/server directory where better-sqlite3 is available
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const db = new Database(path.join(os.homedir(), '.grackle', 'grackle.db'));
db.exec('DELETE FROM findings; DELETE FROM tasks; DELETE FROM projects;');
db.close();
```

### 4. Provision environments

If environments don't exist yet, add them:

```bash
grackle env add demo-recorder --docker --image grackle-demo-recorder --runtime claude-code
grackle env add dev --docker --image grackle-powerline --runtime claude-code
```

Stop and remove old containers, then re-provision:

```bash
docker stop grackle-demo-recorder grackle-dev 2>/dev/null
docker rm grackle-demo-recorder grackle-dev 2>/dev/null
grackle env provision demo-recorder
grackle env provision dev
```

Verify both show "connected":

```bash
grackle env list
```

### 5. Create project and task

```bash
grackle project create "Grackle Demo"
```

Create the demo recording task using the scene script:

```bash
DEMO_DESC=$(cat tools/demo-recorder/DEMO-TASK-PROMPT.md)
grackle task create grackle-demo "Record Demo Video" --env demo-recorder --desc "$DEMO_DESC"
```

### 6. Start the task

```bash
grackle task start <TASK_ID> --model haiku
```

### 7. Monitor

Watch the agent's progress:

```bash
grackle logs <SESSION_ID>
```

Check ffmpeg recording status:

```bash
docker exec grackle-demo-recorder bash -c "ls -lh /workspace/grackle-demo.mp4 2>&1"
```

### 8. Extract video

After the task completes:

```bash
docker cp grackle-demo-recorder:/workspace/grackle-demo.mp4 ./grackle-demo.mp4
```

## Troubleshooting

- **Chrome deadlock**: Never call `mcp__playwright__browser_install` — Chrome is pre-installed
- **No video**: Check `docker exec grackle-demo-recorder bash -c "cat /workspace/ffmpeg.log"`
- **Windows line endings**: If scripts fail with `/bin/bash\r`, run `sed -i 's/\r$//' tools/demo-recorder/*.sh`
- **Auth errors after DB clear**: Remove and re-provision containers (tokens are invalidated)
