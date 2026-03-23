# @grackle-ai/adapter-docker

Grackle environment adapter for managing Docker container environments.

## Overview

The Docker adapter creates and manages Docker containers running PowerLine. It handles image pulling/building, container lifecycle, git repo cloning, and GPU passthrough. Supports Docker-outside-of-Docker (DooD) via `GRACKLE_DOCKER_NETWORK`.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `image` | `string` | `"grackle-powerline:latest"` | Docker image |
| `containerName` | `string` | `"grackle-<envId>"` | Container name |
| `localPort` | `number` | auto | Host port mapping |
| `volumes` | `string[]` | — | Volume mounts |
| `env` | `Record<string, string>` | — | Extra env vars |
| `repo` | `string` | — | Git repo to clone into `/workspace` |
| `gpus` | `string` | — | GPU passthrough (e.g. `"all"`) |

## Prerequisites

- Docker installed and running
- `docker` CLI available on PATH
- Optional: `gh` CLI for private repo cloning
