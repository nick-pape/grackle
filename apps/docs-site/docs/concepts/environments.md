---
id: environments
title: Environments & Adapters
sidebar_position: 1
---

# Environments & Adapters

An **environment** is a compute target where agents run. It could be a Docker container on your laptop, a remote SSH server, a GitHub Codespace, or just your local machine. Grackle doesn't care — they all look the same once connected.

## Adapter types

Each environment uses an **adapter** that knows how to provision, connect, and manage that type of compute.

### Docker

Spins up a container with PowerLine pre-installed. Best for isolation and reproducibility.

```bash
grackle env add my-docker --docker
grackle env add my-docker --docker --image node:22 --repo https://github.com/org/repo
grackle env add my-docker --docker --volume /host/path:/container/path --gpu
```

Options:

- `--image` — Docker image (default: auto-built `grackle-powerline` image)
- `--repo` — Git repo to clone into the container
- `--volume` — Mount host directories (repeatable, format: `host:container[:ro]`)
- `--gpu` — Enable GPU passthrough
- `--attach` — Attach to an existing container instead of creating one (see below)

#### Attach to an existing container

When another tool owns the container lifecycle (for example [Coder](https://github.com/coder/coder) dev-environment workspaces), use `--attach` to point Grackle at an already-running container. Grackle bootstraps PowerLine inside it and drives agent sessions there — it **never creates, stops, or removes** the container.

```bash
# Someone else created `my-workspace`; Grackle just attaches to it
grackle env add my-box --docker --attach my-workspace
grackle env provision my-box
```

`stop`/`destroy` only stop the in-container PowerLine and clean up Grackle's own connectivity helper; the attached container keeps running. Connectivity is automatic: Grackle reaches the container over a shared Docker network when one is configured, by its IP when the host can route to it, or via a small `socat` sidecar otherwise (so it works on Docker Desktop too). In the web UI, choose **Attach to existing container** under the Docker adapter to pick from running containers.

#### Docker-outside-of-Docker (DooD) networking

When Grackle itself runs inside a container (for example, a Compose deployment that mounts the host Docker socket), the spawned containers need a way to reach the Grackle server. These advanced, optional environment variables tune that:

- `GRACKLE_DOCKER_NETWORK` — Docker network name for DooD setups. When set, containers reach the server via the network name instead of host port mapping.
- `GRACKLE_DOCKER_HOST` — DooD host address. When set, wildcard bind addresses (`0.0.0.0`, `::`) resolve to this value so containers can reach the server.
- `GRACKLE_DOCKER_SOCAT_IMAGE` — Image used for the connectivity sidecar in attach mode, started when the host cannot reach an attached container directly (default: `alpine/socat`).

### SSH

Connects to any machine you can SSH into. PowerLine is bootstrapped over SSH automatically.

```bash
grackle env add my-server --ssh --host 10.0.0.5
grackle env add my-server --ssh --host dev.example.com --user deploy --identity-file ~/.ssh/id_ed25519
```

Options:

- `--host` — Hostname or IP (required)
- `--user` — SSH user
- `--ssh-port` — SSH port (default: 22)
- `--identity-file` — Path to private key

### GitHub Codespace

Connects to an existing Codespace by name. Uses `gh codespace ssh` under the hood.

```bash
# Find your codespace name
gh codespace list

grackle env add my-cs --codespace --codespace-name friendly-space-lamp
```

Options:

- `--codespace-name` — Codespace name (from `gh codespace list`)
- `--github-account <label>` — GitHub account label to use for `gh` CLI operations (codespace/docker adapters)

### Local

Runs agents directly on your machine. A local environment is created automatically when you start the server, but you can add more.

```bash
grackle env add another-local --local
grackle env add another-local --local --port 7600
```

Options:

- `--port` — PowerLine port for the local adapter

## Lifecycle

Every environment goes through a simple lifecycle:

```mermaid
stateDiagram-v2
    [*] --> disconnected: env add
    disconnected --> connecting: provision / wake
    connecting --> connected: success
    connecting --> error: failure
    error --> connecting: provision (retry)
    connected --> disconnected: stop
    connected --> sleeping: auto-reconnect exhausted
    sleeping --> connected: probe succeeds
    sleeping --> connecting: wake
    connected --> [*]: destroy
    disconnected --> [*]: remove
```

A **sleeping** environment is one Grackle has temporarily given up actively reconnecting to (for example, a Codespace that stopped). After auto-reconnect exhausts its retries, the environment moves to `sleeping` and Grackle periodically probes it in the background; if a probe succeeds it returns to `connected` on its own. You can also force a reconnect with `env wake`.

| Command         | What it does                                                                           |
| --------------- | -------------------------------------------------------------------------------------- |
| `env add`       | Registers the environment (no connection yet)                                          |
| `env provision` | Bootstraps and connects (installs PowerLine, starts it, establishes tunnel)            |
| `env wake`      | Reconnects a `sleeping` environment (e.g. a stopped Codespace); same flow as provision |
| `env stop`      | Gracefully disconnects                                                                 |
| `env destroy`   | Stops and tears down resources (deletes Docker container, etc.)                        |
| `env remove`    | Unregisters the environment from Grackle                                               |

## Provisioning

When you provision an environment, the adapter:

1. Checks that Node.js >= 22 and git are available
2. Installs the PowerLine package
3. Starts PowerLine as a background process
4. Sets up git credential helpers
5. Establishes a tunnel (SSH port forward, Docker port mapping, etc.)
6. Pushes any stored tokens/credentials to the environment

Progress is streamed to your terminal (or the web UI) as it happens.

## Listing environments

```bash
grackle env list
```

The status column shows the current state:

| Status         | Meaning                                                                       |
| -------------- | ----------------------------------------------------------------------------- |
| `connected`    | Ready — PowerLine is reachable                                                |
| `connecting`   | Provisioning or reconnecting in progress                                      |
| `disconnected` | Stopped or not yet provisioned                                                |
| `sleeping`     | Auto-reconnect gave up; Grackle probes periodically (use `env wake` to retry) |
| `error`        | Provisioning failed                                                           |
