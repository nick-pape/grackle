# @grackle-ai/adapter-docker

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/adapter-docker"><img src="https://img.shields.io/npm/v/@grackle-ai/adapter-docker.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

Grackle environment adapter for managing Docker container environments.

## Overview

The Docker adapter creates and manages Docker containers running PowerLine. It handles image pulling/building, container lifecycle, git repo cloning, and GPU passthrough. Supports Docker-outside-of-Docker (DooD) via `GRACKLE_DOCKER_NETWORK`. It can also **attach** to a pre-existing, externally-managed container instead of creating one (see [Attach mode](#attach-mode)).

## Configuration

| Field           | Type                     | Default                      | Description                                                         |
| --------------- | ------------------------ | ---------------------------- | ------------------------------------------------------------------- |
| `image`         | `string`                 | `"grackle-powerline:latest"` | Docker image (ignored in attach mode)                               |
| `containerName` | `string`                 | `"grackle-<envId>"`          | Container name                                                      |
| `localPort`     | `number`                 | auto                         | Host port mapping                                                   |
| `volumes`       | `string[]`               | —                            | Volume mounts (ignored in attach mode)                              |
| `env`           | `Record<string, string>` | —                            | Extra env vars                                                      |
| `repo`          | `string`                 | —                            | Git repo to clone into `/workspace` (ignored in attach mode)        |
| `gpus`          | `string`                 | —                            | GPU passthrough (e.g. `"all"`)                                      |
| `attach`        | `string`                 | —                            | Name/ID of an existing container to attach to (enables attach mode) |

## Attach mode

When `attach` is set, the adapter **does not create a container**. It bootstraps PowerLine inside the already-running container via `docker exec` and drives agent sessions there. This is for cases where another tool (e.g. [Coder](https://github.com/coder/coder)) owns the container lifecycle.

- **Lifecycle:** Grackle never creates, stops, or removes the attached container. `stop`/`destroy` only stop the in-container PowerLine process and remove Grackle's own connectivity sidecar — the target container is left untouched.
- **Connectivity** is resolved in order: (1) shared Docker network (`GRACKLE_DOCKER_NETWORK`) — reach the container by name (DooD/Coder); (2) the container's bridge IP, if reachable directly from the host (typically native Linux); (3) otherwise a Grackle-owned `socat` sidecar that publishes a host loopback port and forwards into the target's network (works on Docker Desktop / Windows / macOS). Override the sidecar image with `GRACKLE_DOCKER_SOCAT_IMAGE` (default `alpine/socat`).
- **Credentials** are delivered over the PowerLine gRPC connection at task start, so nothing is baked into the container.

```bash
# Attach to a container another tool created
grackle env add my-box --docker --attach my-running-container
grackle env provision my-box
```

## Prerequisites

- Docker installed and running
- `docker` CLI available on PATH
- Optional: `gh` CLI for private repo cloning
- Attach mode: the target container must have Node.js >= 22 and `git` available (PowerLine requirements)
