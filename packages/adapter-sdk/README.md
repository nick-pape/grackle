# @grackle-ai/adapter-sdk

SDK for building [Grackle](https://github.com/nick-pape/grackle) environment adapters.

Grackle runs AI coding agents on remote environments — Docker containers, SSH hosts, GitHub Codespaces, and more. Each environment type is backed by an **adapter**: a small module that knows how to provision, connect, health-check, and tear down that particular kind of compute.

This package provides the interfaces, base classes, and helpers you need to write a custom adapter. If your infrastructure isn't covered by the built-in adapters, you can implement the `EnvironmentAdapter` interface and plug it into the Grackle server.

### Built-in Adapter Packages

- [`@grackle-ai/adapter-local`](https://www.npmjs.com/package/@grackle-ai/adapter-local) — local PowerLine
- [`@grackle-ai/adapter-ssh`](https://www.npmjs.com/package/@grackle-ai/adapter-ssh) — remote hosts via SSH
- [`@grackle-ai/adapter-codespace`](https://www.npmjs.com/package/@grackle-ai/adapter-codespace) — GitHub Codespaces
- [`@grackle-ai/adapter-docker`](https://www.npmjs.com/package/@grackle-ai/adapter-docker) — Docker containers

## Install

```bash
npm install @grackle-ai/adapter-sdk
```

## Key Concepts

### Adapters

An adapter is a class that implements the `EnvironmentAdapter` interface. It tells Grackle how to:

- **Provision** — set up the environment (start a container, launch a VM, etc.) and report progress back as a stream of events.
- **Connect** — establish a gRPC connection to the PowerLine process running inside the environment.
- **Disconnect** — release connection resources without stopping the environment.
- **Stop** — shut down the environment's compute (stop a container, close an SSH session).
- **Destroy** — permanently remove the environment and its artifacts.
- **Health-check** — verify the PowerLine is still reachable.

An adapter may also implement an optional **reconnect** path for fast recovery when the environment was previously bootstrapped.

### PowerLine

The PowerLine is a lightweight gRPC server that runs inside every Grackle environment. It is the bridge between the central Grackle server and the agent running in the environment. The adapter SDK provides helpers to bootstrap, start, probe, and connect to the PowerLine over tunnels or direct connections.

### Tunnels

Many adapters need a port-forwarding tunnel between the local machine and the remote environment (SSH tunnels, `gh codespace ports`, etc.). The SDK includes `ProcessTunnel`, an abstract base class for tunnels backed by a long-lived child process, along with a registry for managing tunnel lifecycles.

### Remote Executor

Adapters that manage remote hosts implement the `RemoteExecutor` interface — a two-method abstraction for running shell commands and copying files to a remote machine. The bootstrap and shared-operations helpers are built on top of this interface, so your adapter only needs to provide the transport layer.

## Requirements

- Node.js >= 22

## License

MIT
