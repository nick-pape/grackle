---
name: demo-record
description: Launch the self-recording Grackle demo. Builds Docker images, cleans state, provisions environments, creates project/task tree, and starts the demo recording agent.
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

### 3. Clean old state via CLI

Archive any existing projects and delete their tasks:

```bash
# List projects, then for each:
grackle project list
# Archive each project: grackle project archive <project-id>
# List tasks: grackle task list <project-id>
# Delete each task: grackle task delete <task-id>
```

Kill any running agents:

```bash
# List running agents, kill each
grackle agent list
grackle kill <session-id>
```

### 4. Provision environments

If environments don't exist yet, add them:

```bash
# Demo recorder with the full AV stack
grackle env add demo-recorder --docker --image grackle-demo-recorder --runtime claude-code

# Dev environment with repo clone (for the coding tasks)
grackle env add dev --docker --image grackle-powerline --runtime claude-code --repo nick-pape/grackle
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

### 5. Create project and task tree

```bash
grackle project create "API Gateway Refactor"
# Note the project ID from output (e.g. "api-gateway-refactor")
```

Create the task tree with parent/child relationships and dependencies:

```bash
# Root parent task (will be pre-completed)
grackle task create <PROJECT_ID> "Design API Schema" --desc "Design the REST API schema including endpoints, request/response types, and error contracts."
# Note the task ID → DESIGN_ID

# Child tasks under Design API Schema (will be pre-completed)
grackle task create <PROJECT_ID> "Define REST endpoints" --parent <DESIGN_ID> --desc "Define all REST endpoint paths, methods, and response schemas."
grackle task create <PROJECT_ID> "Define error contracts" --parent <DESIGN_ID> --desc "Define standard error response format and error codes."

# Dev tasks that depend on design being done
grackle task create <PROJECT_ID> "Implement rate limiter" --env dev --depends-on <DESIGN_ID> --desc "Implement token bucket rate limiting middleware for the API gateway."
# Note the task ID → RATE_LIMITER_ID

grackle task create <PROJECT_ID> "Add auth middleware" --env dev --depends-on <DESIGN_ID> --desc "Add JWT-based authentication middleware to the API gateway."
# Note the task ID → AUTH_ID

# Integration tests depend on both dev tasks
grackle task create <PROJECT_ID> "Write integration tests" --env dev --depends-on <RATE_LIMITER_ID>,<AUTH_ID> --desc "Write end-to-end integration tests for rate limiting and auth middleware."

# The demo recording task (this is the self-referential one)
DEMO_DESC=$(cat tools/demo-recorder/DEMO-TASK-PROMPT.md)
grackle task create <PROJECT_ID> "Record Demo Video" --env demo-recorder --desc "$DEMO_DESC"
```

### 6. Pre-complete design tasks

Use `set-status` to mark the design tasks as done before starting:

```bash
grackle task set-status <DESIGN_ID> done
grackle task set-status <DEFINE_ENDPOINTS_ID> done
grackle task set-status <DEFINE_ERRORS_ID> done
```

### 7. Start the recording task

```bash
grackle task start <RECORDING_TASK_ID> --model haiku
```

**Important**: Use `--model haiku` to keep the demo fast and cheap.

### 8. Monitor

Watch the agent's progress:

```bash
grackle logs <SESSION_ID>
```

Check ffmpeg recording status:

```bash
docker exec grackle-demo-recorder bash -c "ls -lh /workspace/grackle-demo.mp4 2>&1"
```

### 9. Extract video

After the task completes:

```bash
docker cp grackle-demo-recorder:/workspace/grackle-demo.mp4 ./grackle-demo.mp4
```

## GPU Acceleration (Optional)

For faster TTS synthesis, add the demo-recorder with GPU passthrough:

```bash
grackle env add demo-recorder --docker --image grackle-demo-recorder --runtime claude-code --gpu
```

Requires NVIDIA Docker runtime and drivers on the host.

## Troubleshooting

- **Chrome deadlock**: Never call `mcp__playwright__browser_install` — Chrome is pre-installed
- **No video**: Check `docker exec grackle-demo-recorder bash -c "cat /tmp/ffmpeg.log"`
- **Windows line endings**: If scripts fail with `/bin/bash\r`, run `sed -i 's/\r$//' tools/demo-recorder/*.sh`
- **Auth errors after container recreate**: Remove and re-provision containers (tokens are invalidated)
- **Dev agent model**: Always use `--model haiku` when starting tasks to avoid defaulting to expensive models
