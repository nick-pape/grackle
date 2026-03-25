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
